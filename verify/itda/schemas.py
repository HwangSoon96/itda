"""명세 v3의 요청·응답 모양 (백엔드 app/schemas.py 초안, 프론트 decoders.ts와 짝).

값은 영문 코드. 예외: MemoRevision.kind는 프론트가 한글만 읽어서 한글(F21).
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EventType = Literal[
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
]
EventStatus = Literal["present", "absent"]
MemoStatus = Literal["pending", "confirmed", "failed"]
VisitStatus = Literal["scheduled", "completed"]
ChangeType = Literal["start", "increase", "decrease", "stop"]
Mark = Literal["increase", "new", "not_comparable", "insufficient"]
FailureCode = Literal[
    "connection_error",
    "model_not_found",
    "timeout",
    "invalid_format",
    "evidence_mismatch",
    "time_mismatch",
    "interrupted",
    "unknown_error",
]
RevisionKind = Literal["최초 확인", "정정", "직접 추가", "수동 확인"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── 기록 ──────────────────────────────────────────
class Event(Strict):
    type: EventType
    status: EventStatus
    time_expr: str | None
    count: int = Field(ge=1)
    evidence: str = Field(min_length=1)
    model_event_index: int | None = Field(default=None, ge=0)


class Emergency(Strict):
    matched: bool
    message: str | None


class MemoResult(Strict):
    memo_id: int = Field(gt=0)
    status: MemoStatus
    emergency: Emergency
    events: list[Event]
    text: str
    record_date: date
    error: str | None = None
    model_output: str | None = None
    failure_code: FailureCode | None = None


class MemoCreate(Strict):
    text: str = Field(min_length=1, max_length=1000)
    record_date: date
    request_id: str | None = Field(default=None, max_length=100)


class MemoUpdate(Strict):
    text: str = Field(min_length=1, max_length=1000)
    request_id: str | None = Field(default=None, max_length=100)


class ConfirmRequest(Strict):
    events: list[Event] = Field(max_length=100)
    manual: bool = False


class EventCreate(Event):
    memo_id: int = Field(gt=0)


class MemoRevision(Strict):
    id: int = Field(gt=0)
    created_at: str  # ISO 시각 (시간대 포함)
    kind: RevisionKind
    before_events: list[Event]
    after_events: list[Event]


# ── 일정 ──────────────────────────────────────────
class Visit(Strict):
    id: int = Field(gt=0)
    visit_date: date
    status: VisitStatus


class VisitCreate(Strict):
    visit_date: date
    status: VisitStatus = "scheduled"


class VisitUpdate(Strict):
    status: VisitStatus


class Medication(Strict):
    id: int = Field(gt=0)
    name: str
    change_type: ChangeType
    change_date: date


class MedicationCreate(Strict):
    name: str = Field(min_length=1, max_length=100)
    change_type: ChangeType
    change_date: date


class Question(Strict):
    id: int = Field(gt=0)
    text: str
    created_at: str  # "2026-09-24T21:10:00+09:00" (로컬 시각)
    period_start: date | None = None
    period_end: date | None = None


class QuestionCreate(Strict):
    text: str = Field(min_length=1, max_length=1000)
    period_start: date | None = None
    period_end: date | None = None


class Patient(Strict):
    alias: str = Field(max_length=50)


# ── 공통 ──────────────────────────────────────────
class Health(Strict):
    ok: bool
    ai_available: bool | None
    model_name: str
    allow_lan: bool
    emergency_keywords: list[str]
    emergency_message: str
    ai_notice: str
    disclaimer: str
    temporary_model: bool = False


class ErrorBody(Strict):
    detail: str
    code: str


# ── 요약지 · 경과 ─────────────────────────────────
class Period(Strict):
    start: date
    end: date


class Coverage(Strict):
    recorded_days: int = Field(ge=0)
    total_days: int = Field(ge=0)


class SummaryRow(Strict):
    type: EventType
    baseline_rate: float | None = Field(ge=0, le=1)
    current_rate: float | None = Field(ge=0, le=1)
    weekly_count: float | None = Field(ge=0)
    mark: Mark | None
    evidence_dates: list[date]
    memo_ids: list[int]
    occurrence_days: int
    recorded_days: int
    mentioned_days: int
    absent_days: int
    unmentioned_days: int
    baseline_recorded_days: int
    baseline_occurrence_days: int
    baseline_mentioned_days: int
    baseline_absent_days: int
    baseline_unmentioned_days: int


class Sentence(Strict):
    scope: Literal["current", "baseline", "comparison"]
    types: list[EventType]
    text: str
    evidence_dates: list[date]
    memo_ids: list[int]


class Exclusions(Strict):
    pending_memo_ids: list[int]
    failed_memo_ids: list[int]


class Marker(Strict):
    kind: Literal["visit", "medication"]
    date: date
    label: str


class ReportMedication(Strict):
    name: str
    change_type: ChangeType
    date: date


class Week(Strict):
    start: date
    end: date
    period: Literal["baseline", "current"]
    rate: float | None = Field(ge=0, le=1)
    recorded_days: int
    event_days: int
    low_coverage: bool


class Trends(Strict):
    type: EventType
    period: Period
    baseline: Period | None
    markers: list[Marker]
    weeks: list[Week]
    medications: list[ReportMedication]


class Summary(Strict):
    patient_alias: str
    period: Period
    baseline: Period | None
    coverage: Coverage
    baseline_coverage: Coverage | None
    exclusions: Exclusions
    summary_source: Literal["llm", "template"]
    basis_note: str
    trends: list[Trends]
    markers: list[Marker]
    rows: list[SummaryRow]
    sentences: list[Sentence]
    medications: list[ReportMedication]
    falls: list[date]
    questions: list[str]
    disclaimer: str
