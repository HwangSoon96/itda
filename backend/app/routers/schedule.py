"""일정: /visits · /medications · /questions (명세 5장 '일정')."""

import datetime as dt

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select

from ..db import Medication, Question, SessionDep, Visit
from ..errors import ApiError, invalid, not_found, now_iso
from ..schemas import Medication as MedicationOut
from ..schemas import MedicationCreate, QuestionCreate, VisitCreate, VisitUpdate
from ..schemas import Question as QuestionOut
from ..schemas import Visit as VisitOut

router = APIRouter(tags=["일정"])


def _visit(v: Visit) -> dict:
    return VisitOut(id=v.id, visit_date=v.visit_date, status=v.status).model_dump(mode="json")


def _check_completed(visit_date: dt.date, status: str) -> None:
    if status == "completed" and visit_date > dt.date.today():
        raise invalid("오늘 이후 진료는 받은 진료로 등록할 수 없어요.", "future_visit")


@router.get("/visits", response_model=list[VisitOut], summary="진료일 목록")
def list_visits(session: SessionDep):
    return [_visit(v) for v in session.scalars(select(Visit).order_by(Visit.visit_date, Visit.id))]


@router.post("/visits", response_model=VisitOut, status_code=201, summary="진료일 등록")
def add_visit(body: VisitCreate, session: SessionDep):
    _check_completed(body.visit_date, body.status)
    if session.scalar(select(Visit).where(Visit.visit_date == body.visit_date)):
        raise ApiError(409, "visit_exists", "이미 등록된 진료일이에요.")
    v = Visit(visit_date=body.visit_date, status=body.status)
    session.add(v)
    session.commit()
    return _visit(v)


@router.patch("/visits/{visit_id}", response_model=VisitOut, summary="진료 상태 바꾸기")
def update_visit(visit_id: int, body: VisitUpdate, session: SessionDep):
    v = session.get(Visit, visit_id)
    if v is None:
        raise not_found("진료일", "visit_not_found")
    _check_completed(v.visit_date, body.status)
    v.status = body.status
    session.commit()
    return _visit(v)


@router.delete("/visits/{visit_id}", status_code=204, summary="진료일 삭제")
def delete_visit(visit_id: int, session: SessionDep):
    v = session.get(Visit, visit_id)
    if v is None:
        raise not_found("진료일", "visit_not_found")
    session.delete(v)
    session.commit()
    return Response(status_code=204)


def _med(m: Medication) -> dict:
    return MedicationOut(id=m.id, name=m.name, change_type=m.change_type, change_date=m.change_date).model_dump(
        mode="json"
    )


@router.get("/medications", response_model=list[MedicationOut], summary="약 변경 목록")
def list_medications(session: SessionDep):
    return [_med(m) for m in session.scalars(select(Medication).order_by(Medication.change_date, Medication.id))]


@router.post("/medications", response_model=MedicationOut, status_code=201, summary="약 변경 등록")
def add_medication(body: MedicationCreate, session: SessionDep):
    name = body.name.strip()
    if not name:
        raise invalid("약 이름을 적어 주세요.")
    same = session.scalar(
        select(Medication).where(
            Medication.name == name,
            Medication.change_type == body.change_type,
            Medication.change_date == body.change_date,
        )
    )
    if same:  # 같은 변경을 두 번 누름 → 기존 것
        return JSONResponse(_med(same), status_code=200)
    m = Medication(name=name, change_type=body.change_type, change_date=body.change_date)
    session.add(m)
    session.commit()
    return _med(m)


@router.delete("/medications/{medication_id}", status_code=204, summary="약 변경 삭제")
def delete_medication(medication_id: int, session: SessionDep):
    m = session.get(Medication, medication_id)
    if m is None:
        raise not_found("약 변경", "medication_not_found")
    session.delete(m)
    session.commit()
    return Response(status_code=204)


def _question(q: Question) -> dict:
    return QuestionOut(
        id=q.id, text=q.text, created_at=q.created_at, period_start=q.period_start, period_end=q.period_end
    ).model_dump(mode="json")


@router.get("/questions", response_model=list[QuestionOut], summary="질문 목록")
def list_questions(session: SessionDep):
    return [
        _question(q) for q in session.scalars(select(Question).order_by(Question.created_at.desc(), Question.id.desc()))
    ]


@router.post("/questions", response_model=QuestionOut, status_code=201, summary="질문 추가")
def add_question(body: QuestionCreate, session: SessionDep):
    if not body.text.strip():
        raise invalid("질문을 적어 주세요.")
    if (body.period_start is None) != (body.period_end is None):
        raise invalid("시작 날짜와 마지막 날짜를 함께 골라 주세요.")
    if body.period_start and body.period_start > body.period_end:
        raise invalid("시작 날짜를 확인해 주세요.")
    now = now_iso()
    for q in session.scalars(select(Question).where(Question.text == body.text)):
        if q.created_at[:10] == now[:10] and (q.period_start, q.period_end) == (body.period_start, body.period_end):
            return JSONResponse(_question(q), status_code=200)  # 오늘 같은 질문 → 기존 것
    q = Question(text=body.text, created_at=now, period_start=body.period_start, period_end=body.period_end)
    session.add(q)
    session.commit()
    return _question(q)


@router.delete("/questions/{question_id}", status_code=204, summary="질문 삭제")
def delete_question(question_id: int, session: SessionDep):
    q = session.get(Question, question_id)
    if q is None:
        raise not_found("질문", "question_not_found")
    session.delete(q)
    session.commit()
    return Response(status_code=204)
