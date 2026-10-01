"""기록: /memos · /events (명세 5장 '기록').

- 확인 전 카드는 memos.model_output(근거 순서로 정렬된 AI 결과)에서 만들고, events 표에는 확정 때만 넣는다.
- 모델 호출은 비동기(ollama.AsyncClient + async def). 기다리는 동안 서버는 다른 요청을 처리 (V04).
- AI 실패는 200 + status failed (A01).
"""

import asyncio
import datetime as dt
import json
from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import Event as EventRow
from ..db import Memo, MemoRevision, RequestKey, SessionDep, SessionLocal
from ..errors import ApiError, Id, invalid, not_found, now_iso
from ..schemas import (
    ConfirmRequest,
    Event,
    EventCreate,
    MemoCreate,
    MemoResult,
    MemoUpdate,
)
from ..schemas import (
    MemoRevision as RevisionOut,
)
from ..services import emergency, extract

router = APIRouter(tags=["기록"])
EVENT_KEYS = ("type", "status", "time_expr", "count", "evidence")


def _get(session: Session, memo_id: int) -> Memo:
    memo = session.get(Memo, memo_id)
    if memo is None:
        raise not_found("메모", "memo_not_found")
    return memo


def _model_events(memo: Memo) -> list[dict]:
    return json.loads(memo.model_output)["events"] if memo.model_output else []


def _cards(memo: Memo) -> list[dict]:
    if memo.status == "confirmed":
        return [{k: getattr(e, k) for k in (*EVENT_KEYS, "model_event_index")} for e in memo.events]
    if memo.status == "pending":
        return [{**e, "model_event_index": i} for i, e in enumerate(_model_events(memo))]
    return []


def to_result(memo: Memo) -> MemoResult:
    return MemoResult(
        memo_id=memo.id,
        status=memo.status,
        emergency=emergency.check(memo.text),
        events=_cards(memo),
        text=memo.text,
        record_date=memo.record_date,
        error=memo.error,
        model_output=memo.model_output,
        failure_code=memo.failure_code,
    )


def _check_text(text: str) -> None:
    if not text.strip():
        raise invalid("메모를 적어 주세요.")


def _check_events(memo: Memo, events: list[Event]) -> None:
    for e in events:
        if e.evidence not in memo.text:
            raise invalid("근거 구절은 원문에 있는 내용으로 골라 주세요.", "evidence_not_in_text")
        if e.time_expr is not None and e.time_expr not in memo.text:
            raise invalid("시간 표현은 원문에 있는 내용으로 적어 주세요.", "time_not_in_text")


async def _run_ai(memo_id: Id, version: int) -> None:
    """AI를 부르는 동안에는 DB 세션을 잡지 않는다. 끝나고 원문 버전이 그대로일 때만 결과를 쓴다 (F05)."""
    with SessionLocal() as s:
        text = s.get(Memo, memo_id).text
    events, fail = await extract.extract(text)
    with SessionLocal() as s:
        memo = s.get(Memo, memo_id)
        if memo is None or memo.text_version != version:
            return  # 그사이 지웠거나 원문을 다시 고침 → 늦게 온 결과는 버림
        if events is not None:
            memo.status, memo.model_output, memo.error, memo.failure_code = (
                "pending",
                json.dumps({"events": events}, ensure_ascii=False),
                None,
                None,
            )
        else:
            memo.status, memo.model_output, (memo.failure_code, memo.error) = "failed", None, fail
        memo.updated_at = now_iso()
        s.commit()


_running: set[asyncio.Task] = set()


async def _organize(memo_id: Id, version: int) -> None:
    """정리를 서버 쪽 작업으로 띄우고 기다린다. 화면이 새로고침·창 닫기로 요청을 끊어도
    작업은 끝까지 돌아 결과가 DB에 남는다 (shield). 화면은 지금처럼 응답을 기다리면 된다."""
    task = asyncio.create_task(_run_ai(memo_id, version))
    _running.add(task)
    task.add_done_callback(_running.discard)
    await asyncio.shield(task)


def _revision(session: Session, memo: Memo, kind: str, before: list[dict]) -> None:
    after = _cards(memo)
    session.add(
        MemoRevision(
            memo_id=memo.id,
            kind=kind,
            created_at=now_iso(),
            before_events=json.dumps(before, ensure_ascii=False),
            after_events=json.dumps(after, ensure_ascii=False),
        )
    )


@router.post("/memos", response_model=MemoResult, summary="메모 저장하고 AI로 정리")
async def create_memo(body: MemoCreate, session: SessionDep):
    _check_text(body.text)
    if body.record_date > dt.date.today():
        raise invalid("미래 날짜는 고를 수 없어요.", "future_date")
    if body.request_id and (key := session.get(RequestKey, body.request_id)):
        if key.deleted:
            raise ApiError(409, "request_deleted", "삭제한 메모의 저장 요청이에요. 새 메모로 다시 작성해 주세요.")
        if key.kind != "create" or key.text != body.text or key.record_date != body.record_date:
            raise ApiError(409, "request_conflict", "같은 저장 요청 번호에 다른 메모가 있어요.")
        return to_result(_get(session, key.memo_id))
    now = now_iso()
    memo = Memo(record_date=body.record_date, text=body.text, status="pending", created_at=now, updated_at=now)
    session.add(memo)
    session.flush()
    if body.request_id:
        session.add(
            RequestKey(
                request_id=body.request_id,
                memo_id=memo.id,
                kind="create",
                text=body.text,
                record_date=body.record_date,
                created_at=now,
            )
        )
    session.commit()  # 원문부터 저장: AI가 실패해도 메모는 남음
    memo_id = memo.id  # 정리 중에 지워질 수 있어 id를 먼저 잡아 둠 (지워졌으면 _get이 404)
    await _organize(memo_id, memo.text_version)
    session.expire_all()
    return to_result(_get(session, memo_id))


@router.patch("/memos/{memo_id}", response_model=MemoResult, summary="원문 수정하고 다시 정리")
async def update_memo(memo_id: Id, body: MemoUpdate, session: SessionDep):
    _check_text(body.text)
    if body.request_id and (key := session.get(RequestKey, body.request_id)):
        if key.deleted:
            raise ApiError(409, "request_deleted", "삭제한 메모의 수정 요청이에요.")
        if key.kind != "update" or key.memo_id != memo_id or key.text != body.text:
            raise ApiError(409, "request_conflict", "같은 수정 요청 번호에 다른 메모나 원문을 쓸 수 없어요.")
        memo = _get(session, memo_id)
        if memo.text != body.text:
            raise ApiError(409, "request_conflict", "이미 다른 원문으로 수정한 메모예요. 최신 메모를 다시 열어 주세요.")
        return to_result(memo)
    memo = _get(session, memo_id)
    memo.text, memo.text_version = body.text, memo.text_version + 1
    memo.status, memo.model_output, memo.error, memo.failure_code = "pending", None, None, None
    memo.events.clear()
    memo.revisions.clear()  # 이력은 원문 버전에 속함
    memo.updated_at = now_iso()
    if body.request_id:
        session.add(
            RequestKey(
                request_id=body.request_id, memo_id=memo_id, kind="update", text=body.text, created_at=memo.updated_at
            )
        )
    session.commit()
    await _organize(memo_id, memo.text_version)
    session.expire_all()
    return to_result(_get(session, memo_id))


@router.post("/memos/{memo_id}/confirm", response_model=MemoResult, summary="카드 확정 (처음 확인 · 정정 · 직접 정리)")
def confirm_memo(memo_id: Id, body: ConfirmRequest, session: SessionDep):
    memo = _get(session, memo_id)
    if memo.status == "failed" and not body.manual:
        raise ApiError(409, "memo_failed", "직접 정리한 내용을 확인하거나 메모 정리를 다시 시도해 주세요.")
    _check_events(memo, body.events)
    n_model = len(_model_events(memo))
    idx = [e.model_event_index for e in body.events if e.model_event_index is not None]
    if body.manual and idx:
        raise invalid("직접 정리에는 AI 사건 출처 번호를 지정할 수 없어요.", "invalid_model_index")
    if any(i >= n_model for i in idx) or len(idx) != len(set(idx)):
        raise invalid("AI 사건 출처 번호를 확인해 주세요.", "invalid_model_index")
    before = _cards(memo)
    was_confirmed = memo.status == "confirmed"
    memo.events.clear()
    session.flush()
    for i, e in enumerate(body.events):
        memo.events.append(EventRow(ord=i, **e.model_dump()))
    memo.status, memo.error, memo.failure_code, memo.updated_at = "confirmed", None, None, now_iso()
    session.flush()
    session.refresh(memo)
    kind = "정정" if was_confirmed else "수동 확인" if body.manual else "최초 확인"
    if not was_confirmed or before != _cards(memo):
        _revision(session, memo, kind, before)
    session.commit()
    return to_result(memo)


@router.post("/memos/{memo_id}/retry", response_model=MemoResult, summary="정리 실패 메모 다시 정리")
async def retry_memo(memo_id: Id, session: SessionDep):
    memo = _get(session, memo_id)
    if memo.status != "failed":
        raise ApiError(409, "memo_not_failed", "정리 실패 메모만 다시 시도할 수 있어요.")
    await _organize(memo_id, memo.text_version)
    session.expire_all()
    return to_result(_get(session, memo_id))


@router.get("/memos/{memo_id}/revisions", response_model=list[RevisionOut], summary="수정 이력")
def memo_revisions(memo_id: Id, session: SessionDep):
    _get(session, memo_id)
    rows = session.scalars(select(MemoRevision).where(MemoRevision.memo_id == memo_id).order_by(MemoRevision.id.desc()))
    return [
        RevisionOut(
            id=r.id,
            created_at=r.created_at,
            kind=r.kind,
            before_events=json.loads(r.before_events),
            after_events=json.loads(r.after_events),
        )
        for r in rows
    ]


@router.get("/memos", response_model=list[MemoResult], summary="메모 목록")
def list_memos(
    session: SessionDep,
    date_from: Annotated[dt.date | None, Query(alias="from")] = None,
    date_to: Annotated[dt.date | None, Query(alias="to")] = None,
):
    if date_from and date_to and date_from > date_to:
        raise invalid("시작일은 종료일보다 늦을 수 없어요.")
    q = select(Memo).order_by(Memo.record_date.desc(), Memo.id.desc())
    if date_from:
        q = q.where(Memo.record_date >= date_from)
    if date_to:
        q = q.where(Memo.record_date <= date_to)
    return [to_result(m) for m in session.scalars(q)]


@router.delete("/memos/{memo_id}", status_code=204, summary="메모 삭제")
def delete_memo(memo_id: Id, session: SessionDep):
    memo = _get(session, memo_id)
    for key in session.scalars(select(RequestKey).where(RequestKey.memo_id == memo_id)):
        key.deleted = True
    session.delete(memo)
    session.commit()
    return Response(status_code=204)


@router.post("/events", response_model=MemoResult, summary="확인 완료 메모에 사건 추가")
def add_event(body: EventCreate, session: SessionDep):
    memo = _get(session, body.memo_id)
    if memo.status != "confirmed":
        raise ApiError(409, "memo_not_confirmed", "확인 완료한 메모에 사건을 추가해 주세요.")
    if body.model_event_index is not None:
        raise invalid("직접 추가한 사건은 AI 사건 출처 번호를 가질 수 없어요.", "invalid_model_index")
    event = Event.model_validate(body.model_dump(exclude={"memo_id"}))
    _check_events(memo, [event])
    if event.model_dump() not in _cards(memo):
        before = _cards(memo)
        memo.events.append(EventRow(ord=len(memo.events), **event.model_dump()))
        memo.updated_at = now_iso()
        session.flush()
        session.refresh(memo)
        _revision(session, memo, "직접 추가", before)
        session.commit()
    return to_result(memo)


def recover_interrupted() -> None:
    """서버가 AI 처리 중에 꺼졌던 메모(pending인데 결과 없음)를 정리 실패로 (명세 7장 interrupted)."""
    with SessionLocal() as s:
        for memo in s.scalars(select(Memo).where(Memo.status == "pending", Memo.model_output.is_(None))):
            memo.status, (memo.failure_code, memo.error) = "failed", extract.failure("interrupted")
        s.commit()
