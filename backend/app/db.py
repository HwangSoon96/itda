"""SQLite 테이블 8개 (ERD · 테이블 정의서 v3). 제약은 문서의 DDL과 같게 둔다."""

from collections.abc import Iterator
from datetime import date
from typing import Annotated

from fastapi import Depends
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import NullPool

from .settings import db_path

EVENT_TYPES = (
    "night_waking",
    "wandering_exit",
    "agitation",
    "irritability",
    "anxiety",
    "low_mood_apathy",
    "delusion",
    "hallucination",
    "reduced_intake",
    "medication_refusal",
    "confusion",
    "fall",
)
FAILURE_CODES = (
    "connection_error",
    "model_not_found",
    "timeout",
    "invalid_format",
    "evidence_mismatch",
    "time_mismatch",
    "interrupted",
    "unknown_error",
)
REVISION_KINDS = ("최초 확인", "정정", "직접 추가", "수동 확인")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Base(DeclarativeBase):
    """시각은 로컬 시각+시간대 ISO 문자열('2026-09-24T21:10:00+09:00')로 저장. SQLite DateTime은 시간대를 버림."""


class Memo(Base):
    __tablename__ = "memos"
    __table_args__ = (
        CheckConstraint("length(text) BETWEEN 1 AND 1000", name="memo_text_length"),
        CheckConstraint(_in("status", ("pending", "confirmed", "failed")), name="memo_status"),
        CheckConstraint(_in("failure_code", FAILURE_CODES), name="memo_failure_code"),
        CheckConstraint("(status = 'failed') = (failure_code IS NOT NULL)", name="memo_failed_has_code"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_date: Mapped[date] = mapped_column(Date, index=True)  # 보호자가 고른 '일어난 날' = 모든 사건의 날짜
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="pending")
    model_output: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    failure_code: Mapped[str | None] = mapped_column(String)
    text_version: Mapped[int] = mapped_column(Integer, default=1)  # 원문을 고칠 때마다 +1
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)

    events: Mapped[list["Event"]] = relationship(
        back_populates="memo", cascade="all, delete-orphan", passive_deletes=True, order_by="Event.ord"
    )
    revisions: Mapped[list["MemoRevision"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)


class Event(Base):
    """확정된 사건만. 확인 전 카드는 Memo.model_output에만 있다."""

    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint(_in("type", EVENT_TYPES), name="event_type"),
        CheckConstraint(_in("status", ("present", "absent")), name="event_status"),
        CheckConstraint("count >= 1", name="event_count"),
        CheckConstraint("length(evidence) >= 1", name="event_evidence"),
        CheckConstraint("model_event_index >= 0", name="event_model_index"),
        UniqueConstraint("memo_id", "ord"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    memo_id: Mapped[int] = mapped_column(ForeignKey("memos.id", ondelete="CASCADE"), index=True)
    ord: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    count: Mapped[int] = mapped_column(Integer, default=1)
    evidence: Mapped[str] = mapped_column(Text)  # 원문 안에 있는지는 API가 검사
    time_expr: Mapped[str | None] = mapped_column(String)
    model_event_index: Mapped[int | None] = mapped_column(Integer)  # 직접 추가·직접 정리는 NULL

    memo: Mapped[Memo] = relationship(back_populates="events")


class MemoRevision(Base):
    __tablename__ = "memo_revisions"
    __table_args__ = (CheckConstraint(_in("kind", REVISION_KINDS), name="revision_kind"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    memo_id: Mapped[int] = mapped_column(ForeignKey("memos.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String)  # 프론트가 한글로 읽음 (명세 F21)
    before_events: Mapped[str] = mapped_column(Text)  # JSON 배열
    after_events: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String)


class RequestKey(Base):
    """중복 저장 방지. memo_id는 FK가 아님: 메모를 지워도 '지운 메모의 요청'을 기억한다."""

    __tablename__ = "request_keys"
    __table_args__ = (CheckConstraint(_in("kind", ("create", "update")), name="request_kind"),)
    request_id: Mapped[str] = mapped_column(String, primary_key=True)
    memo_id: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    record_date: Mapped[date | None] = mapped_column(Date)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String)


class Visit(Base):
    """받은 진료(completed)가 오늘 이후면 안 되는 규칙은 오늘 날짜가 필요해서 API가 검사."""

    __tablename__ = "visits"
    __table_args__ = (CheckConstraint(_in("status", ("scheduled", "completed")), name="visit_status"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visit_date: Mapped[date] = mapped_column(Date, unique=True)
    status: Mapped[str] = mapped_column(String, default="scheduled")


class Medication(Base):
    __tablename__ = "medications"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="medication_name"),
        CheckConstraint(_in("change_type", ("start", "increase", "decrease", "stop")), name="medication_change"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    change_type: Mapped[str] = mapped_column(String)
    change_date: Mapped[date] = mapped_column(Date)


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (
        CheckConstraint("length(text) BETWEEN 1 AND 1000", name="question_text"),
        CheckConstraint("(period_start IS NULL) = (period_end IS NULL)", name="question_period"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String)  # 로컬 시각+시간대 (명세 R03)
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)


class Patient(Base):
    __tablename__ = "patient"
    __table_args__ = (
        CheckConstraint("id = 1", name="patient_single"),
        CheckConstraint("length(alias) <= 50", name="patient_alias"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alias: Mapped[str] = mapped_column(String)


def make_engine(url: str | None = None):
    # 연결을 풀에 모아 두지 않음: async API가 AI를 기다리는 동안 연결을 쥐고 있으면, 동시 저장이 풀 크기(15)를
    # 넘을 때 다음 요청이 이벤트 루프를 막은 채 빈 연결을 기다려 서버 전체가 멈춘다. SQLite 파일 연결은 바로 열린다.
    engine = create_engine(
        url or f"sqlite:///{db_path()}", connect_args={"check_same_thread": False}, poolclass=NullPool
    )

    @event.listens_for(engine, "connect")
    def _foreign_keys(conn, _record):  # 연결할 때마다 켜야 CASCADE가 동작함
        conn.execute("PRAGMA foreign_keys = ON")

    return engine


SessionLocal = sessionmaker(expire_on_commit=False)


def configure(url: str | None = None) -> None:
    """DB 파일에 연결. 앱을 만들 때 부름 (ITDA_DB를 그때 읽음)."""
    SessionLocal.configure(bind=make_engine(url))


def init_db(bind=None) -> None:
    Base.metadata.create_all(bind or SessionLocal.kw["bind"])


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
