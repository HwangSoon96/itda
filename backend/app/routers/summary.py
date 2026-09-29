"""요약지·경과: /summary · /trends, 환자: /patient (명세 5장)."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import Medication, Memo, Patient, Question, SessionDep, Visit
from ..errors import invalid
from ..schemas import EventType, Summary, Trends
from ..schemas import Patient as PatientOut
from ..services import stats, summarize
from ..settings import labels, settings

router = APIRouter(tags=["요약지 · 경과"])
BASIS = (
    "보호자가 기록한 내용 기준임. 기록한 날 언급이 없는 증상은 없었던 것으로 계산하며, "
    "횟수가 적히지 않은 기록은 1회로 계산함."
)
CHANGE_KO = {"start": "시작", "increase": "증량", "decrease": "감량", "stop": "중단"}


def _load(session: Session) -> dict:
    memos = [
        {
            "memo_id": m.id,
            "record_date": m.record_date.isoformat(),
            "status": m.status,
            "events": [{"type": e.type, "status": e.status, "count": e.count} for e in m.events],
        }
        for m in session.scalars(select(Memo).options(selectinload(Memo.events)))
    ]
    visits = [{"visit_date": v.visit_date.isoformat(), "status": v.status} for v in session.scalars(select(Visit))]
    meds = sorted(
        (
            {"id": m.id, "name": m.name, "change_type": m.change_type, "date": m.change_date.isoformat()}
            for m in session.scalars(select(Medication))
        ),
        key=lambda x: (x["date"], x["id"]),
    )
    return {"memos": memos, "visits": visits, "medications": meds}


def _dates(as_of: dt.date | None, period_start: dt.date | None) -> tuple[str, str | None]:
    end = as_of or dt.date.today()
    if period_start and period_start > end:
        raise invalid("시작일은 기준 날짜보다 늦을 수 없어요.")
    return end.isoformat(), period_start.isoformat() if period_start else None


def _markers(data, cur, base) -> list[dict]:
    first = base["start"] if base else cur["start"]
    visits = [
        {"kind": "visit", "date": v["visit_date"], "label": "진료일"}
        for v in data["visits"]
        if v["status"] == "completed" and first <= v["visit_date"] <= cur["end"]
    ]
    meds = [
        {"kind": "medication", "date": m["date"], "label": f"{m['name']} · {CHANGE_KO[m['change_type']]}"}
        for m in data["medications"]
        if first <= m["date"] <= cur["end"]
    ]
    return sorted(visits + meds, key=lambda x: (x["date"], x["kind"]))


def _trends(data, t, cur, base) -> dict:
    first = base["start"] if base else cur["start"]
    return {
        "type": t,
        "period": cur,
        "baseline": base,
        "markers": _markers(data, cur, base),
        "weeks": stats.weeks(data["memos"], t, cur, base, settings()),
        "medications": [
            {k: m[k] for k in ("name", "change_type", "date")}
            for m in data["medications"]
            if first <= m["date"] <= cur["end"]
        ],
    }


def _public(row: dict) -> dict:
    return {k: v for k, v in row.items() if not k.startswith("_")}


@router.get("/summary", response_model=Summary)
async def summary(
    session: SessionDep,
    as_of: dt.date | None = None,
    period_start: dt.date | None = None,
    ai: bool = True,
):  # 요약 모델은 비동기로 부름 (V04)
    end, start = _dates(as_of, period_start)
    cfg, data = settings(), _load(session)
    memos = data["memos"]
    cur, base, cov, rows = stats.rows(memos, data["visits"], list(labels()["type"]), end, start, cfg)
    base_cov = len(stats.observe(memos, base)["recorded"]) if base else 0
    fall = next(r for r in rows if r["type"] == "fall")

    def coverage_sources(period):
        if not period:
            return {"evidence_dates": [], "memo_ids": []}
        hit = [m for m in memos if m["status"] == "confirmed" and period["start"] <= m["record_date"] <= period["end"]]
        return {
            "evidence_dates": sorted({m["record_date"] for m in hit}),
            "memo_ids": sorted(m["memo_id"] for m in hit),
        }

    source, sentences = "template", None
    if ai and summarize.signals(rows) or ai and fall["_occ"]:
        sentences = await summarize.llm(rows, fall["_occ"], fall, cov, cur, base)
        source = "llm" if sentences else "template"
    if sentences is None:
        sentences = summarize.template(rows, fall["_occ"], fall, cov, cur, base, base_cov, coverage_sources)
    in_cur = [m for m in memos if cur["start"] <= m["record_date"] <= cur["end"]]
    questions = session.scalars(select(Question).order_by(Question.created_at, Question.id))
    patient = session.get(Patient, 1)
    top = stats.trend_types(rows, memos, base, cfg)
    return {
        "patient_alias": patient.alias if patient else "",
        "period": cur,
        "baseline": base,
        "coverage": {"recorded_days": cov, "total_days": stats.ndays(cur["start"], cur["end"])},
        "baseline_coverage": {"recorded_days": base_cov, "total_days": stats.ndays(base["start"], base["end"])}
        if base
        else None,
        "exclusions": {
            "pending_memo_ids": sorted(m["memo_id"] for m in in_cur if m["status"] == "pending"),
            "failed_memo_ids": sorted(m["memo_id"] for m in in_cur if m["status"] == "failed"),
        },
        "summary_source": source,
        "basis_note": BASIS,
        "trends": [_trends(data, t, cur, base) for t in top],
        "markers": _markers(data, cur, base),
        "rows": [_public(r) for r in rows],
        "sentences": sentences,
        "medications": [
            {k: m[k] for k in ("name", "change_type", "date")}
            for m in data["medications"]
            if cur["start"] <= m["date"] <= cur["end"]
        ],
        "falls": fall["_occ"],
        "questions": [q.text for q in questions if cur["start"] <= q.created_at[:10] <= cur["end"]],
        "disclaimer": cfg["disclaimer"],
    }


@router.get("/trends", response_model=Trends)
def trends(
    session: SessionDep,
    type: Annotated[EventType, Query()],
    as_of: dt.date | None = None,
    period_start: dt.date | None = None,
):
    end, start = _dates(as_of, period_start)
    data = _load(session)
    cur, base = stats.periods(data["visits"], data["memos"], end, start)
    return _trends(data, type, cur, base)


@router.get("/patient", response_model=PatientOut)
def get_patient(session: SessionDep):
    p = session.get(Patient, 1)
    return {"alias": p.alias if p else ""}


@router.put("/patient", response_model=PatientOut)
def put_patient(body: PatientOut, session: SessionDep):
    alias = body.alias.strip()
    if not alias:
        raise invalid("이름 또는 가명을 적어 주세요.")
    p = session.get(Patient, 1) or Patient(id=1, alias=alias)
    p.alias = alias
    session.add(p)
    session.commit()
    return {"alias": alias}
