"""스캐폴드 확인: 동결 파일끼리 맞는지, DB 제약, /health, /api 접두어."""

import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import db
from app.errors import now_iso
from app.routers import health as health_router
from app.schemas import EventType
from app.settings import event_schema, labels, settings


def test_frozen_files_agree():
    codes = list(labels()["type"])
    assert codes == list(EventType.__args__) == list(db.EVENT_TYPES)
    assert event_schema()["properties"]["events"]["items"]["properties"]["type"]["enum"] == codes
    s = settings()
    assert s["memo_max_chars"] == 1000 and s["min_baseline_recorded_days"] == 14
    assert "date_expressions" not in s  # 명세 F01: 사건 날짜 = 메모 날짜


@pytest.fixture
def session(tmp_path):
    engine = db.make_engine(f"sqlite:///{tmp_path / 't.db'}")
    db.init_db(engine)
    with Session(engine) as s:
        yield s


def memo(**kw):
    now = now_iso()
    return db.Memo(
        **{"record_date": date(2026, 9, 23), "text": "새벽에 깨심", "created_at": now, "updated_at": now, **kw}
    )


@pytest.mark.parametrize(
    "bad",
    [
        lambda: memo(text="가" * 1001),
        lambda: memo(status="failed"),  # 실패인데 이유 없음
        lambda: memo(status="failed", failure_code="timeot"),
        lambda: db.Visit(visit_date=date(2026, 8, 20), status="done"),
        lambda: db.Patient(id=2, alias="b"),
        lambda: db.Question(text="q", created_at=now_iso(), period_start=date(2026, 9, 1)),
    ],
)
def test_db_rejects_bad_rows(session, bad):
    session.add(bad())
    with pytest.raises(IntegrityError):
        session.commit()


def test_event_rules_and_cascade(session):
    m = memo(text="가" * 1000)
    session.add(m)
    session.commit()
    for kw in (dict(type="sleepy"), dict(count=0), dict(evidence="")):
        session.add(
            db.Event(
                **{"memo_id": m.id, "ord": 9, "type": "fall", "status": "present", "count": 1, "evidence": "x", **kw}
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
    session.add(db.Event(memo_id=m.id, ord=0, type="fall", status="present", count=1, evidence="x"))
    session.add(db.RequestKey(request_id="r1", memo_id=m.id, kind="create", text="가", created_at=now_iso()))
    session.commit()
    session.delete(m)
    session.commit()
    assert session.query(db.Event).count() == 0 and session.query(db.RequestKey).count() == 1


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("ITDA_DB", str(tmp_path / "app.db"))
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


def test_health_without_ollama(client, monkeypatch):
    monkeypatch.setattr(health_router, "ollama_host", lambda: "http://127.0.0.1:9")  # 닫힌 포트
    body = client.get("/health").json()
    assert body["ok"] is True and body["ai_available"] is False
    assert body["emergency_keywords"] and body["disclaimer"]


@pytest.mark.parametrize("path", ["/health", "/api/health"])
def test_api_prefix_is_optional(client, monkeypatch, path):
    async def ready(_name):
        return True

    monkeypatch.setattr(health_router, "model_ready", ready)
    r = client.get(path)
    assert r.status_code == 200 and r.json()["ai_available"] is True


def test_sqlite_has_foreign_keys_on():
    assert sqlite3.sqlite_version_info >= (3, 8)
    with db.make_engine("sqlite://").connect() as c:
        assert c.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
