"""API 흐름 시험. AI는 extract.extract를 바꿔 끼워 모델 없이 돌린다."""

import asyncio
import datetime as dt
import json
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.routers import memos as memos_router
from app.services import extract, summarize

TEXT = "새벽 3시쯤 깨서 현관문 열려고 하심. 저녁은 반 공기밖에 안 드심. 낮에는 혼자 있으면 불안해하심."
MODEL = {
    "events": [
        {
            "type": "wandering_exit",
            "status": "present",
            "time_expr": "새벽 3시쯤",
            "count": 1,
            "evidence": "현관문 열려고 하심",
        },
        {
            "type": "night_waking",
            "status": "present",
            "time_expr": "새벽 3시쯤",
            "count": 1,
            "evidence": "새벽 3시쯤 깨서",
        },
    ]
}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("ITDA_DB", str(tmp_path / "t.db"))
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


async def fake_ok(text):
    return extract.parse(text, json.dumps(MODEL, ensure_ascii=False))


async def fake_down(text):
    return None, extract.failure("connection_error")


@pytest.fixture
def ai_ok(monkeypatch):
    monkeypatch.setattr(memos_router.extract, "extract", fake_ok)


@pytest.fixture
def ai_down(monkeypatch):
    monkeypatch.setattr(memos_router.extract, "extract", fake_down)


def new_memo(c, **kw):
    return c.post("/memos", json={"text": TEXT, "record_date": "2026-09-23", **kw})


# ── 모델 결과 검사 ──────────────────────────────────
def test_parse_sorts_by_evidence_and_rejects_bad_output():
    events, fail = extract.parse(TEXT, json.dumps(MODEL, ensure_ascii=False))
    assert fail is None and [e["type"] for e in events] == ["night_waking", "wandering_exit"]
    bad = {"events": [dict(MODEL["events"][0], evidence="없는 문장")]}
    assert extract.parse(TEXT, json.dumps(bad))[1][0] == "evidence_mismatch"
    bad = {"events": [dict(MODEL["events"][0], time_expr="어젯밤")]}
    assert extract.parse(TEXT, json.dumps(bad))[1][0] == "time_mismatch"
    assert extract.parse(TEXT, '{"events": [{"type": "sleepy"}]}')[1][0] == "invalid_format"
    assert extract.parse(TEXT, "not json")[1][0] == "invalid_format"


def test_summary_lines_keep_leading_date():
    out = "1. 2026-08-22와 2026-09-14에 낙상이 기록됨.\n- 야간 각성: 증가 표시됨.\n\n2) 환각: 기록됨.\n"
    out += "2026-07-24에 처음 기록됨."
    assert summarize.split_lines(out) == [
        "2026-08-22와 2026-09-14에 낙상이 기록됨.",
        "야간 각성: 증가 표시됨.",
        "환각: 기록됨.",
        "2026-07-24에 처음 기록됨.",
    ]


# ── 기록 흐름 ──────────────────────────────────────
def test_create_confirm_add_revisions(client, ai_ok):
    r = new_memo(client, request_id="req-1")
    m = r.json()
    assert r.status_code == 200 and m["status"] == "pending" and m["record_date"] == "2026-09-23"
    assert [e["model_event_index"] for e in m["events"]] == [0, 1]
    assert client.get("/memos").json()[0]["events"] == m["events"]  # 다시 열어도 같은 카드

    again = new_memo(client, request_id="req-1").json()  # 재전송 → 같은 메모
    assert again["memo_id"] == m["memo_id"] and len(client.get("/memos").json()) == 1
    assert (
        client.post("/memos", json={"text": "다른 글", "record_date": "2026-09-23", "request_id": "req-1"}).json()[
            "code"
        ]
        == "request_conflict"
    )

    cards = m["events"]
    cards[1]["count"] = 2
    done = client.post(f"/memos/{m['memo_id']}/confirm", json={"events": cards}).json()
    assert done["status"] == "confirmed" and done["events"][1]["count"] == 2

    add = {
        "memo_id": m["memo_id"],
        "type": "anxiety",
        "status": "present",
        "time_expr": "낮에는",
        "count": 1,
        "evidence": "혼자 있으면 불안해하심",
        "model_event_index": None,
    }
    added = client.post("/events", json=add).json()
    assert len(added["events"]) == 3 and added["events"][2]["model_event_index"] is None
    client.post("/events", json=add)  # 같은 사건은 더하지 않음
    assert len(client.get("/memos").json()[0]["events"]) == 3

    fixed = added["events"][:2]
    client.post(f"/memos/{m['memo_id']}/confirm", json={"events": fixed})
    kinds = [x["kind"] for x in client.get(f"/memos/{m['memo_id']}/revisions").json()]
    assert kinds == ["정정", "직접 추가", "최초 확인"]


def test_confirm_validation(client, ai_ok):
    m = new_memo(client).json()
    url = f"/memos/{m['memo_id']}/confirm"
    bad = [dict(m["events"][0], evidence="원문에 없음")]
    assert client.post(url, json={"events": bad}).json()["code"] == "evidence_not_in_text"
    dup = [m["events"][0], dict(m["events"][1], model_event_index=0)]
    assert client.post(url, json={"events": dup}).status_code == 422
    assert client.post(url, json={"events": [dict(m["events"][0], model_event_index=7)]}).status_code == 422
    assert client.post(url, json={"events": []}).json()["status"] == "confirmed"  # 사건 없는 기록일


def test_failed_memo_manual_retry(client, ai_down, monkeypatch):
    m = new_memo(client).json()
    assert m["status"] == "failed" and m["failure_code"] == "connection_error" and m["events"] == []
    url = f"/memos/{m['memo_id']}/confirm"
    card = {"type": "night_waking", "status": "present", "time_expr": None, "count": 1, "evidence": "새벽 3시쯤 깨서"}
    assert client.post(url, json={"events": [card]}).json()["code"] == "memo_failed"
    ok = client.post(url, json={"events": [dict(card, model_event_index=None)], "manual": True}).json()
    assert ok["status"] == "confirmed"
    assert client.post(f"/memos/{m['memo_id']}/retry").json()["code"] == "memo_not_failed"

    m2 = new_memo(client, text=TEXT + " ").json()
    monkeypatch.setattr(memos_router.extract, "extract", fake_ok)
    assert client.post(f"/memos/{m2['memo_id']}/retry").json()["status"] == "pending"


def test_update_resets_and_delete(client, ai_ok):
    m = new_memo(client, request_id="c1").json()
    client.post(f"/memos/{m['memo_id']}/confirm", json={"events": m["events"]})
    up = client.patch(f"/memos/{m['memo_id']}", json={"text": TEXT + " 오후엔 좋으셨음.", "request_id": "u1"}).json()
    assert up["status"] == "pending" and up["record_date"] == "2026-09-23"
    assert client.get(f"/memos/{m['memo_id']}/revisions").json() == []
    assert (
        client.patch(f"/memos/{m['memo_id']}", json={"text": "다름", "request_id": "u1"}).json()["code"]
        == "request_conflict"
    )

    assert client.delete(f"/memos/{m['memo_id']}").status_code == 204
    assert client.get("/memos").json() == []
    assert new_memo(client, request_id="c1").json()["code"] == "request_deleted"
    assert client.delete(f"/memos/{m['memo_id']}").json()["code"] == "memo_not_found"


def test_memo_input_rules(client, ai_ok):
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    assert client.post("/memos", json={"text": "a", "record_date": tomorrow}).json()["code"] == "future_date"
    assert client.post("/memos", json={"text": "가" * 1001, "record_date": "2026-09-23"}).status_code == 422
    assert client.post("/memos", json={"text": "   ", "record_date": "2026-09-23"}).status_code == 422
    new_memo(client)
    assert client.get("/memos", params={"from": "2026-09-24"}).json() == []
    assert len(client.get("/memos", params={"from": "2026-09-23", "to": "2026-09-23"}).json()) == 1
    assert client.get("/memos", params={"from": "2026-09-24", "to": "2026-09-01"}).status_code == 422


def test_interrupted_memo_becomes_failed(client):
    from app.db import Memo, SessionLocal
    from app.routers.memos import recover_interrupted

    with SessionLocal() as s:
        s.add(Memo(record_date=dt.date(2026, 9, 23), text="a", status="pending", created_at="t", updated_at="t"))
        s.commit()
    recover_interrupted()
    assert client.get("/memos").json()[0]["failure_code"] == "interrupted"


# ── 일정 · 환자 ────────────────────────────────────
def test_schedule(client):
    future = (dt.date.today() + dt.timedelta(days=5)).isoformat()
    assert client.post("/visits", json={"visit_date": future, "status": "completed"}).json()["code"] == "future_visit"
    v = client.post("/visits", json={"visit_date": future})
    assert v.status_code == 201 and v.json()["status"] == "scheduled"
    assert client.post("/visits", json={"visit_date": future}).json()["code"] == "visit_exists"
    assert client.patch(f"/visits/{v.json()['id']}", json={"status": "completed"}).status_code == 422
    past = client.post("/visits", json={"visit_date": "2026-08-20", "status": "completed"}).json()
    assert [x["visit_date"] for x in client.get("/visits").json()] == ["2026-08-20", future]
    assert client.delete(f"/visits/{past['id']}").status_code == 204

    med = {"name": " 예시 약 ", "change_type": "start", "change_date": "2026-08-25"}
    assert client.post("/medications", json=med).status_code == 201
    again = client.post("/medications", json=med)
    assert again.status_code == 200 and again.json()["name"] == "예시 약"

    q = client.post("/questions", json={"text": "물어볼 것"})
    assert q.status_code == 201 and q.json()["created_at"][10] == "T" and q.json()["created_at"][-6] in "+-"
    assert client.post("/questions", json={"text": "물어볼 것"}).status_code == 200
    assert client.post("/questions", json={"text": "x", "period_start": "2026-09-01"}).status_code == 422

    assert client.get("/patient").json() == {"alias": ""}
    assert client.put("/patient", json={"alias": " 이OO "}).json() == {"alias": "이OO"}
    assert client.put("/patient", json={"alias": " "}).status_code == 422


# ── 요약지: 프론트 목 서버와 같은 숫자 ──────────────────
FIX = json.loads((Path(__file__).parent / "fixtures" / "frontend_mock_2026-09-27.json").read_text(encoding="utf-8"))


def test_summary_matches_frontend_mock(client):
    from app import demo

    demo.load()
    got = client.get("/summary", params={"as_of": FIX["as_of"], "ai": "false"}).json()
    want = FIX["summary"]
    for k in want:
        if k != "basis_note":  # 문구는 명세 8장 고정 문구
            assert got[k] == want[k], k
    assert (
        client.get("/trends", params={"type": "night_waking", "as_of": FIX["as_of"]}).json()
        == FIX["trends_night_waking"]
    )
    got_period = client.get("/summary/period", params={"as_of": FIX["as_of"]}).json()
    assert got_period == {"period": want["period"], "baseline": want["baseline"]}
    assert client.get("/summary/period", params={"as_of": "2026-09-01", "period_start": "2026-09-02"}).status_code == 422
    assert client.get("/summary", params={"as_of": "2026-09-01", "period_start": "2026-09-02"}).status_code == 422
    assert client.get("/trends", params={"type": "sleepy"}).status_code == 422


def test_summary_without_visits_or_records(client):
    s = client.get("/summary", params={"as_of": "2026-09-27", "ai": "false"}).json()
    assert s["period"] == {"start": "2026-09-27", "end": "2026-09-27"} and s["baseline"] is None
    assert s["sentences"][0]["text"].startswith("비교할 기록이 부족해")


def test_api_prefix(client):
    assert client.get("/api/memos").json() == client.get("/memos").json() == []


@pytest.mark.anyio
async def test_server_answers_while_model_is_thinking(monkeypatch, tmp_path):
    """비동기 모델 호출: 정리가 2초 걸리는 동안에도 /health·/visits가 바로 응답한다."""
    monkeypatch.setenv("ITDA_DB", str(tmp_path / "a.db"))

    async def slow(text):
        await asyncio.sleep(2)
        return await fake_ok(text)

    monkeypatch.setattr(memos_router.extract, "extract", slow)
    from app.routers import health as health_router

    async def ready(_name):
        return True

    monkeypatch.setattr(health_router, "model_ready", ready)
    from app.db import init_db
    from app.main import create_app

    app = create_app()
    init_db()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        done = {}

        async def timed(name, coro):
            t = time.perf_counter()
            r = await coro
            done[name] = time.perf_counter() - t
            return r

        memo, health, visits = await asyncio.gather(
            timed("memo", c.post("/memos", json={"text": TEXT, "record_date": "2026-09-23"})),
            timed("health", c.get("/health")),
            timed("visits", c.get("/visits")),
        )
    assert memo.json()["status"] == "pending" and health.status_code == visits.status_code == 200
    assert done["memo"] >= 2 and done["health"] < 0.5 and done["visits"] < 0.5


@pytest.mark.anyio
async def test_organizing_finishes_even_if_screen_leaves(monkeypatch, tmp_path):
    """보호자가 정리 중에 창을 닫아(요청이 끊겨)도 서버는 정리를 끝내고 결과를 저장한다."""
    monkeypatch.setenv("ITDA_DB", str(tmp_path / "b.db"))

    async def slow(text):
        await asyncio.sleep(1)
        return await fake_ok(text)

    monkeypatch.setattr(memos_router.extract, "extract", slow)
    from app.db import init_db
    from app.main import create_app

    app = create_app()
    init_db()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        req = asyncio.create_task(c.post("/memos", json={"text": TEXT, "record_date": "2026-09-23"}))
        await asyncio.sleep(0.3)
        req.cancel()  # 화면이 기다리다 떠남
        with pytest.raises(asyncio.CancelledError):
            await req
        await asyncio.sleep(1.2)
        memos = (await c.get("/memos")).json()
    assert len(memos) == 1 and memos[0]["status"] == "pending" and len(memos[0]["events"]) == 2
