"""복잡한 상황 시험: 기간 경계값, 무작위 시나리오 대조, 기록 CRUD 연쇄, 동시 요청.

요약지·경과 숫자는 구현(stats.py)을 쓰지 않고 날짜를 하루씩 세는 독립 계산(oracle)으로 대조한다.
증가 표시 기준은 부동소수점이 아닌 정확한 분수로 계산한다: c/n > p + σ·sqrt(p(1-p)/n).
"""

import asyncio
import datetime as dt
import json
import random
import re
import time
from fractions import Fraction

import httpx
import pytest
from fastapi.testclient import TestClient

from app.routers import memos as memos_router
from app.services import extract, summarize
from app.settings import labels, settings

D = dt.date.fromisoformat
TYPES = list(labels()["type"])
CFG = settings()
TODAY = dt.date.today()


@pytest.fixture(autouse=True)
def no_real_ollama(monkeypatch):
    monkeypatch.setenv("OLLAMA_HOST", "http://127.0.0.1:9")  # 실제 모델을 부르지 않음 (연결 즉시 실패)


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("ITDA_DB", str(tmp_path / "s.db"))
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


# ── 데이터 직접 넣기 (시나리오용) ────────────────────────
def seed(memos=(), visits=(), meds=(), questions=()):
    """memos: (date, status, [(type, status, count)]) · visits: (date, status) · meds: (name, change, date)
    questions: (text, created_date). 메모 id는 넣은 순서대로 1부터."""
    from app.db import Event, Medication, Memo, Question, SessionLocal, Visit

    with SessionLocal() as s:
        for d, st, evs in memos:
            m = Memo(
                record_date=D(d),
                text="기록",
                status=st,
                failure_code="connection_error" if st == "failed" else None,
                model_output='{"events": []}' if st == "pending" else None,
                created_at="t",
                updated_at="t",
            )
            for i, (t, es, n) in enumerate(evs):
                m.events.append(Event(ord=i, type=t, status=es, count=n, evidence="기록", time_expr=None))
            s.add(m)
        s.add_all(Visit(visit_date=D(d), status=st) for d, st in visits)
        s.add_all(Medication(name=n, change_type=c, change_date=D(d)) for n, c, d in meds)
        s.add_all(Question(text=q, created_at=f"{d}T10:00:00+09:00") for q, d in questions)
        s.commit()


def days(a, b):
    a, b = D(a), D(b)
    return [(a + dt.timedelta(n)).isoformat() for n in range((b - a).days + 1)]


def run(start, n, *evs, status="confirmed"):
    """start부터 n일 동안 매일 메모 하나."""
    return [(d, status, list(evs)) for d in days(start, (D(start) + dt.timedelta(n - 1)).isoformat())]


def get_summary(c, as_of, start=None, ai="false"):
    p = {"as_of": as_of, "ai": ai}
    if start:
        p["period_start"] = start
    r = c.get("/summary", params=p)
    assert r.status_code == 200, r.text
    return r.json()


def row(s, t):
    return next(r for r in s["rows"] if r["type"] == t)


# ── 독립 계산 (oracle) ──────────────────────────────────
def exact_increase(b_occ, n_base, c_occ, n_cur):
    p, x = Fraction(b_occ, n_base), Fraction(c_occ, n_cur)
    sigma = Fraction(str(CFG["sigma"]))
    return x > p and (x - p) ** 2 > sigma**2 * p * (1 - p) / n_cur


def oracle(memos, visits, as_of, start):
    conf = [(i + 1, d, evs) for i, (d, st, evs) in enumerate(memos) if st == "confirmed"]
    done = sorted(d for d, st in visits if st == "completed" and d <= as_of)
    known = sorted(d for _, d, _ in conf if d <= as_of)
    s = start or (done[-1] if done else None) or (known[0] if known else None) or as_of
    prev = [d for d in done if d < s]
    cur = {"start": s, "end": as_of}
    base = {"start": prev[-1], "end": (D(s) - dt.timedelta(1)).isoformat()} if prev else None

    def day_facts(per, t):
        """per 안의 날짜별: 기록했나, 해당 유형 있었나/없었나, 횟수, 메모."""
        out = {}
        for d in days(per["start"], per["end"]) if per else []:
            hits = [(i, evs) for i, md, evs in conf if md == d]
            if not hits:
                continue
            ev = [(i, e) for i, evs in hits for e in evs if e[0] == t]
            out[d] = {
                "present": any(e[1] == "present" for _, e in ev),
                "mentioned": bool(ev),
                "count": sum(e[2] for _, e in ev if e[1] == "present"),
                "mids": {i for i, _ in ev},
                "pmids": {i for i, e in ev if e[1] == "present"},
            }
        return out

    rows = {}
    for t in TYPES:
        c, b = day_facts(cur, t), day_facts(base, t)
        n, nb = len(c), len(b)
        co, bo = sum(v["present"] for v in c.values()), sum(v["present"] for v in b.values())
        if base is None or nb < CFG["min_baseline_recorded_days"]:
            mark = "not_comparable"
        elif n < CFG["min_recorded_days"]:
            mark = "insufficient"
        elif bo == 0 and co > 0:
            mark = "new"
        elif co >= CFG["min_event_days"] and exact_increase(bo, nb, co, n):
            mark = "increase"
        else:
            mark = None
        enough = mark not in ("insufficient", "not_comparable")
        cnt = sum(v["count"] for v in c.values())
        rows[t] = {
            "type": t,
            "baseline_rate": round(bo / nb, 4) if nb else None,
            "current_rate": round(co / n, 4) if n else None,
            "weekly_count": round(cnt / n * 7, 1) if n and enough else None,
            "mark": mark,
            "evidence_dates": sorted(d for x in (b, c) for d, v in x.items() if v["mentioned"]),
            "memo_ids": sorted({i for x in (b, c) for v in x.values() for i in v["mids"]}),
            "occurrence_days": co,
            "recorded_days": n,
            "mentioned_days": sum(v["mentioned"] for v in c.values()),
            "absent_days": sum(v["mentioned"] and not v["present"] for v in c.values()),
            "unmentioned_days": sum(not v["mentioned"] for v in c.values()),
            "baseline_recorded_days": nb,
            "baseline_occurrence_days": bo,
            "baseline_mentioned_days": sum(v["mentioned"] for v in b.values()),
            "baseline_absent_days": sum(v["mentioned"] and not v["present"] for v in b.values()),
            "baseline_unmentioned_days": sum(not v["mentioned"] for v in b.values()),
            "_occ": sorted(d for d, v in c.items() if v["present"]),
        }
    return cur, base, rows


def oracle_weeks(memos, t, cur, base):
    conf = [(d, evs) for d, st, evs in memos if st == "confirmed"]
    out = []
    for per, kind in ((base, "baseline"), (cur, "current")):
        if not per:
            continue
        groups = {}
        for d in days(per["start"], per["end"]):  # 월~일 한 주 (ISO 주)
            groups.setdefault(D(d).isocalendar()[:2], []).append(d)
        for ds in groups.values():
            rec = {d for d, _ in conf if d in ds}
            occ = {d for d, evs in conf if d in ds and any(e[0] == t and e[1] == "present" for e in evs)}
            low = len(rec) < CFG["low_coverage_week_days"]
            out.append(
                {
                    "start": ds[0],
                    "end": ds[-1],
                    "period": kind,
                    "rate": None if low else round(len(occ) / len(rec), 4),
                    "recorded_days": len(rec),
                    "event_days": len(occ),
                    "low_coverage": low,
                }
            )
    return out


def check_against_oracle(c, memos, visits, meds, questions, as_of, start):
    s = get_summary(c, as_of, start)
    cur, base, rows = oracle(memos, visits, as_of, start)
    assert s["period"] == cur and s["baseline"] == base
    cov = rows[TYPES[0]]["recorded_days"]
    assert s["coverage"] == {"recorded_days": cov, "total_days": len(days(cur["start"], cur["end"]))}
    if base:
        n_b = rows[TYPES[0]]["baseline_recorded_days"]
        assert s["baseline_coverage"] == {"recorded_days": n_b, "total_days": len(days(base["start"], base["end"]))}
    else:
        assert s["baseline_coverage"] is None
    in_cur = {
        st: [i + 1 for i, (d, x, _) in enumerate(memos) if x == st and cur["start"] <= d <= as_of]
        for st in ("pending", "failed")
    }
    assert s["exclusions"] == {"pending_memo_ids": in_cur["pending"], "failed_memo_ids": in_cur["failed"]}
    for r in s["rows"]:
        want = {k: v for k, v in rows[r["type"]].items() if not k.startswith("_")}
        assert r == want, r["type"]
    assert s["falls"] == rows["fall"]["_occ"]

    # 추이 유형: 기준·이번 중 큰 발생일 ≥ trend_min_days, 변화 큰 순 상위 N (같으면 라벨 순)
    has_base = base is not None and rows[TYPES[0]]["baseline_recorded_days"] > 0

    def mag(t):
        r = rows[t]
        cr = Fraction(r["occurrence_days"], r["recorded_days"]) if r["recorded_days"] else Fraction(0)
        br = Fraction(r["baseline_occurrence_days"], r["baseline_recorded_days"]) if r["baseline_recorded_days"] else 0
        return abs(cr - br) if has_base else cr

    cand = [
        t
        for t in TYPES
        if max(rows[t]["occurrence_days"], rows[t]["baseline_occurrence_days"]) >= CFG["trend_min_days"]
    ]
    got = [x["type"] for x in s["trends"]]
    assert len(got) == min(len(cand), CFG["trend_top_n"]) and set(got) <= set(cand)
    assert [mag(t) for t in got] == sorted((mag(t) for t in cand), reverse=True)[: len(got)]
    for tr in s["trends"]:
        assert tr["weeks"] == oracle_weeks(memos, tr["type"], cur, base)
        assert tr["period"] == cur and tr["baseline"] == base

    first = base["start"] if base else cur["start"]
    change_ko = {"start": "시작", "increase": "증량", "decrease": "감량", "stop": "중단"}
    want_markers = sorted(
        [
            {"kind": "visit", "date": d, "label": "진료일"}
            for d, st in visits
            if st == "completed" and first <= d <= as_of
        ]
        + [
            {"kind": "medication", "date": d, "label": f"{n} · {change_ko[ch]}"}
            for n, ch, d in meds
            if first <= d <= as_of
        ],
        key=lambda x: (x["date"], x["kind"]),
    )
    assert sorted(s["markers"], key=lambda x: (x["date"], x["kind"], x["label"])) == sorted(
        want_markers, key=lambda x: (x["date"], x["kind"], x["label"])
    )
    assert [(m["date"], m["kind"]) for m in s["markers"]] == sorted((m["date"], m["kind"]) for m in s["markers"])
    assert sorted((m["date"], m["name"]) for m in s["medications"]) == sorted(
        (d, n) for n, _, d in meds if cur["start"] <= d <= as_of
    )
    assert sorted(s["questions"]) == sorted(q for q, d in questions if cur["start"] <= d <= as_of)

    # 문장: 근거는 보고 범위 안의 확인된 메모만
    confirmed = {i + 1 for i, m in enumerate(memos) if m[1] == "confirmed"}
    for sen in s["sentences"]:
        assert set(sen["memo_ids"]) <= confirmed
        assert all(first <= d <= as_of for d in sen["evidence_dates"])
        assert not any(w in sen["text"] for w in CFG["forbidden_expressions"])
    assert 1 <= len(s["sentences"]) <= CFG["max_summary_sentences"]
    flagged = {t for t, r in rows.items() if t != "fall" and r["mark"] in ("increase", "new")}
    assert {t for sen in s["sentences"] for t in sen["types"]} - {"fall"} == flagged or len(s["sentences"]) == 5

    t = random.Random(as_of).choice(TYPES)  # 요약지에 안 나온 유형도 /trends로 확인
    tr = c.get("/trends", params={"type": t, "as_of": as_of, **({"period_start": start} if start else {})}).json()
    assert tr["weeks"] == oracle_weeks(memos, t, cur, base) and tr["period"] == cur and tr["baseline"] == base


def random_world(seed_n):
    rnd = random.Random(seed_n)
    as_of = (TODAY - dt.timedelta(rnd.randint(0, 900))).isoformat()
    span = rnd.choice([3, 20, 45, 90, 160])
    lo = D(as_of) - dt.timedelta(span)
    hot = rnd.sample(TYPES, rnd.randint(1, 5))
    pick = lambda: (lo + dt.timedelta(rnd.randint(0, span + 10))).isoformat()  # noqa: E731  as_of 뒤 기록도 섞음
    visits = {}
    for _ in range(rnd.randint(0, 4)):
        d = pick()
        visits[d] = "completed" if D(d) <= TODAY and rnd.random() < 0.8 else "scheduled"
    density, surge = rnd.choice([0.2, 0.6, 0.95]), rnd.random() < 0.5
    memos = []
    for d in days(lo.isoformat(), (lo + dt.timedelta(span + 10)).isoformat()):
        if D(d) > TODAY or rnd.random() > density:
            continue
        for _ in range(rnd.choice([1, 1, 1, 2, 3])):  # 같은 날 여러 메모
            st = rnd.choices(["confirmed", "pending", "failed"], [0.85, 0.08, 0.07])[0]
            evs = []
            if st == "confirmed":
                late = surge and d > (D(as_of) - dt.timedelta(span // 3)).isoformat()
                for t in hot:
                    roll = rnd.random()
                    if roll < (0.6 if late else 0.25):
                        evs.append((t, "present", rnd.choice([1, 1, 2, 5])))
                    elif roll < 0.45:
                        evs.append((t, "absent", 1))
                if rnd.random() < 0.05:
                    evs.append(("fall", "present", 1))
            memos.append((d, st, evs))
    meds = [
        (rnd.choice(["도네페질", "쿠에티아핀"]), rnd.choice(["start", "increase", "decrease", "stop"]), pick())
        for _ in range(rnd.randint(0, 3))
    ]
    questions = [(f"질문{i}", pick()) for i in range(rnd.randint(0, 3))]
    options = [None, as_of, (D(as_of) - dt.timedelta(rnd.randint(1, span))).isoformat()]
    options += [d for d in visits if d <= as_of] + [m[0] for m in memos if m[0] <= as_of][:3]
    start = rnd.choice(options)
    return memos, sorted(visits.items()), meds, questions, as_of, start


@pytest.mark.parametrize("seed_n", range(150))
def test_random_worlds_match_oracle(client, seed_n):
    memos, visits, meds, questions, as_of, start = random_world(seed_n)
    seed(memos, visits, meds, questions)
    check_against_oracle(client, memos, visits, meds, questions, as_of, start)


# ── 기간 경계값 ──────────────────────────────────────
def test_period_start_boundaries(client):
    seed(run("2026-06-01", 30, ("night_waking", "present", 1)), [("2026-06-10", "completed")])
    assert get_summary(client, "2026-06-30", "2026-06-30")["period"] == {"start": "2026-06-30", "end": "2026-06-30"}
    assert client.get("/summary", params={"as_of": "2026-06-30", "period_start": "2026-07-01"}).status_code == 422
    assert (
        client.get("/trends", params={"type": "fall", "as_of": "2026-06-30", "period_start": "2026-07-01"}).status_code
        == 422
    )
    for bad in ("2026-02-30", "2026-13-01", "20260601", "", "yesterday"):
        assert client.get("/summary", params={"as_of": bad}).status_code == 422, bad
    s = get_summary(client, "2026-06-10")  # 진료일 당일 → 그날부터 이번 구간, 기준 없음
    assert s["period"]["start"] == "2026-06-10" and s["baseline"] is None and s["coverage"]["recorded_days"] == 1
    s = get_summary(client, "2026-06-09")  # 진료일 하루 전 → 진료가 아직 없음 → 첫 기록일부터
    assert s["period"] == {"start": "2026-06-01", "end": "2026-06-09"} and s["baseline"] is None
    s = get_summary(client, "2026-06-30", "2026-06-11")  # 진료 다음 날 시작 → 기준은 진료일 하루
    assert s["baseline"] == {"start": "2026-06-10", "end": "2026-06-10"}
    assert s["baseline_coverage"] == {"recorded_days": 1, "total_days": 1}
    s = get_summary(client, "2026-06-30", "2026-06-10")  # 시작 = 진료일 → 그 진료는 기준이 아님
    assert s["baseline"] is None


def test_future_and_extreme_as_of_are_rejected_cleanly(client):
    seed([("2026-01-05", "confirmed", [("fall", "present", 1)])], [("2026-01-01", "completed")])
    tomorrow = (TODAY + dt.timedelta(1)).isoformat()
    for as_of in (tomorrow, "9999-12-31"):
        for path, extra in (("/summary", {}), ("/summary/period", {}), ("/trends", {"type": "fall"})):
            r = client.get(path, params={"as_of": as_of, **extra})
            assert r.status_code == 422 and r.json()["code"] == "future_date", (path, as_of)
    assert client.get("/trends", params={"type": "fall", "as_of": TODAY.isoformat()}).status_code == 200


def test_very_long_period_stays_fast(client):
    seed(
        run("2026-01-01", 30, ("night_waking", "present", 1)) + run("2026-02-01", 30, ("night_waking", "present", 1)),
        [("2026-01-01", "completed")],
    )
    t = time.perf_counter()
    s = get_summary(client, TODAY.isoformat(), "0001-01-02")
    assert s["period"]["start"] == "0001-01-02" and s["coverage"]["recorded_days"] == 60
    assert s["baseline"] is None and s["coverage"]["total_days"] == (TODAY - dt.date(1, 1, 2)).days + 1
    assert client.get("/trends", params={"type": "night_waking", "period_start": "0001-01-02"}).status_code == 200
    assert time.perf_counter() - t < 5


def test_same_day_present_and_absent_counts_once_as_present(client):
    memos = [
        ("2026-05-01", "confirmed", [("agitation", "absent", 1)]),
        ("2026-05-01", "confirmed", [("agitation", "present", 2), ("agitation", "present", 3)]),
        ("2026-05-02", "confirmed", [("agitation", "absent", 1), ("agitation", "absent", 1)]),
        ("2026-05-03", "confirmed", []),
        ("2026-05-03", "pending", []),
        ("2026-05-04", "failed", []),
    ]
    seed(memos)
    r = row(get_summary(client, "2026-05-04"), "agitation")
    assert (r["recorded_days"], r["occurrence_days"], r["absent_days"], r["mentioned_days"], r["unmentioned_days"]) == (
        3,
        1,
        1,
        2,
        1,
    )
    assert r["memo_ids"] == [1, 2, 3] and r["evidence_dates"] == ["2026-05-01", "2026-05-02"]
    s = get_summary(client, "2026-05-04")
    assert s["exclusions"] == {"pending_memo_ids": [5], "failed_memo_ids": [6]}
    assert s["coverage"] == {"recorded_days": 3, "total_days": 4}


def test_pending_failed_outside_current_period_not_excluded(client):
    seed(
        [
            ("2026-04-01", "pending", []),
            ("2026-04-02", "failed", []),
            ("2026-04-10", "confirmed", []),
            ("2026-04-20", "pending", []),
        ],
        [("2026-04-05", "completed")],
    )
    s = get_summary(client, "2026-04-15")
    assert s["period"]["start"] == "2026-04-05" and s["exclusions"] == {"pending_memo_ids": [], "failed_memo_ids": []}


# ── 증가 표시 경계 ─────────────────────────────────────
def mark_world(b_rec, b_occ, c_rec, c_occ, t="delusion"):
    """기준 구간(진료 사이) b_rec일 중 b_occ일, 이번 구간 c_rec일 중 c_occ일 발생."""
    b0 = dt.date(2025, 1, 1)
    c0 = b0 + dt.timedelta(b_rec)
    ev = lambda on: [(t, "present", 1)] if on else []  # noqa: E731
    memos = [((b0 + dt.timedelta(i)).isoformat(), "confirmed", ev(i < b_occ)) for i in range(b_rec)]
    memos += [((c0 + dt.timedelta(i)).isoformat(), "confirmed", ev(i < c_occ)) for i in range(c_rec)]
    return memos, [(b0.isoformat(), "completed"), (c0.isoformat(), "completed")], (c0 + dt.timedelta(c_rec - 1))


@pytest.mark.parametrize(
    ("b", "c", "mark"),
    [
        ((13, 5), (20, 20), "not_comparable"),  # 기준 기록일 13 < 14
        ((14, 5), (13, 13), "insufficient"),  # 이번 기록일 13 < 14
        ((14, 0), (14, 1), "new"),  # 기준 0회 → 하루만 나와도 새로 나타남
        ((14, 0), (14, 0), None),
        ((14, 14), (14, 14), None),  # 기준 100%는 더 늘 수 없음
        ((14, 1), (14, 3), None),  # 3일이지만 기준선 이하
        ((20, 1), (20, 2), None),  # 기준선은 넘지만 최소 3일 미만
        ((15, 10), (72, 60), None),  # 정확히 기준선 (float로 계산하면 증가로 잘못 판정)
        ((15, 10), (72, 61), "increase"),
        ((26, 18), (121, 99), None),  # 정확히 기준선
        ((28, 3), (147, 27), None),  # 정확히 기준선
        ((91, 75), (147, 135), None),  # 정확히 기준선
        ((14, 7), (36, 27), None),  # 정확히 기준선 (float도 맞는 경우)
        ((14, 7), (36, 28), "increase"),
    ],
)
def test_mark_boundaries(client, b, c, mark):
    memos, visits, as_of = mark_world(*b, *c)
    seed(memos, visits)
    s = get_summary(client, as_of.isoformat())
    r = row(s, "delusion")
    assert (r["baseline_recorded_days"], r["baseline_occurrence_days"], r["recorded_days"], r["occurrence_days"]) == (
        *b,
        *c,
    )
    assert r["mark"] == mark
    assert (r["weekly_count"] is None) == (mark in ("insufficient", "not_comparable"))
    if mark in ("new", "increase"):
        assert any(sen["types"] == ["delusion"] for sen in s["sentences"])


def test_weekly_count_sums_counts_not_days(client):
    memos, visits, as_of = mark_world(14, 1, 14, 0)
    memos[-1] = (memos[-1][0], "confirmed", [("delusion", "present", 5)])
    memos.append((memos[-1][0], "confirmed", [("delusion", "present", 2)]))
    seed(memos, visits)
    r = row(get_summary(client, as_of.isoformat()), "delusion")
    assert r["occurrence_days"] == 1 and r["weekly_count"] == 3.5  # 7회 / 14일 × 7


# ── 주 나누기 ─────────────────────────────────────────
def test_weeks_split_on_sunday_and_low_coverage(client):
    # 2026-03-04(수) ~ 2026-03-16(월): 수~일(5일) / 월~일 / 월(1일)
    memos = [
        (d, "confirmed", [("confusion", "present", 1)] if d.endswith(("05", "06", "07")) else [])
        for d in days("2026-03-04", "2026-03-16")
        if d not in ("2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12")
    ]
    seed(memos)
    w = client.get("/trends", params={"type": "confusion", "as_of": "2026-03-16", "period_start": "2026-03-04"}).json()
    assert [(x["start"], x["end"]) for x in w["weeks"]] == [
        ("2026-03-04", "2026-03-08"),
        ("2026-03-09", "2026-03-15"),
        ("2026-03-16", "2026-03-16"),
    ]
    assert [(x["recorded_days"], x["event_days"], x["rate"], x["low_coverage"]) for x in w["weeks"]] == [
        (5, 3, 0.6, False),
        (3, 0, None, True),
        (1, 0, None, True),
    ]


def test_weeks_across_year_end_and_leap_day(client):
    seed(run("2023-12-28", 70, ("anxiety", "present", 1)), [("2023-12-28", "completed")])
    w = client.get("/trends", params={"type": "anxiety", "as_of": "2024-03-06"}).json()["weeks"]
    assert w[0] == {
        "start": "2023-12-28",
        "end": "2023-12-31",
        "period": "current",
        "rate": 1.0,
        "recorded_days": 4,
        "event_days": 4,
        "low_coverage": False,
    }
    assert ("2024-02-26", "2024-03-03") in [(x["start"], x["end"]) for x in w]  # 윤일 포함 주
    assert sum(x["recorded_days"] for x in w) == 70 and w[-1]["end"] == "2024-03-06"
    s = get_summary(client, "2024-03-06")
    assert s["coverage"] == {"recorded_days": 70, "total_days": 70}


# ── 문장 틀 · 요약 모델 ────────────────────────────────
def test_template_sentences(client):
    memos, visits, as_of = mark_world(14, 0, 14, 3, "hallucination")
    for d in ("2025-01-16", "2025-01-18", "2025-01-20", "2025-01-22", "2025-01-24"):
        memos.append((d, "confirmed", [("fall", "present", 1)]))
    seed(memos, visits)
    s = get_summary(client, as_of.isoformat())
    assert s["summary_source"] == "template"
    assert s["sentences"][0]["text"] == "낙상: 2025-01-16, 2025-01-18, 2025-01-20 외 2일에 기록됨."
    assert "기준 구간에는 기록이 없었고 이번 구간 2025-01-15에 처음 기록됨 (총 3일)" in s["sentences"][1]["text"]
    assert len(s["sentences"]) == 3 and s["sentences"][2]["scope"] == "current"

    empty = get_summary(client, "2024-01-01")
    assert empty["sentences"][0]["text"].startswith("비교할 기록이 부족해")


class FakeChat:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), 0

    def __call__(self, **_kw):
        outer = self

        class Client:
            async def chat(self, **_):
                outer.calls += 1
                r = outer.replies.pop(0)
                if isinstance(r, Exception):
                    raise r

                class M:
                    message = type("X", (), {"content": r})

                return M

        return Client()


@pytest.mark.parametrize(
    ("replies", "source", "calls"),
    [
        (["낙상: 2025-02-01에 기록됨."], "llm", 1),
        (["낙상이 악화되었습니다 2025-02-01.", "낙상: 2025-02-01에 기록됨."], "llm", 2),  # 금지 표현 → 재시도
        (["낙상: 2025-02-01에 기록됨. 7회", "약 때문에 낙상 2025-02-01"], "template", 2),  # 없는 숫자·원인 해석
        ([ConnectionError("down")], "template", 1),
        (["기록이 있었음."], "template", 2),  # 낙상 누락 → 재시도 후 문장 틀
        (["기록이 있었음.", "기록이 있었음."], "template", 2),
    ],
)
def test_llm_summary_validation_and_fallback(client, monkeypatch, replies, source, calls):
    fake = FakeChat(replies + ["기록이 있었음."])
    monkeypatch.setattr(summarize, "AsyncClient", fake)
    seed([("2025-02-01", "confirmed", [("fall", "present", 1)])])
    s = get_summary(client, "2025-02-01", ai="true")
    assert s["summary_source"] == source and fake.calls == calls
    if source == "llm":
        assert s["sentences"] == [
            {
                "scope": "current",
                "types": ["fall"],
                "text": "낙상: 2025-02-01에 기록됨.",
                "evidence_dates": ["2025-02-01"],
                "memo_ids": [1],
            }
        ]
    assert get_summary(client, "2025-02-01", ai="false")["summary_source"] == "template" and fake.calls == calls


# ── 기록 CRUD 연쇄 (키워드로 동작하는 가짜 AI) ────────────
KW = {
    "밤에깸": "night_waking",
    "배회": "wandering_exit",
    "불안": "anxiety",
    "넘어짐": "fall",
    "거부": "medication_refusal",
}


def keyword_events(text):
    evs = []
    for m in re.finditer(r"(밤에깸|배회|불안|넘어짐|거부)(없음)?(?:x(\d+))?", text):
        evs.append(
            {
                "type": KW[m[1]],
                "status": "absent" if m[2] else "present",
                "time_expr": None,
                "count": int(m[3] or 1),
                "evidence": m[0],
            }
        )
    return evs


async def fake_ai(text):
    if "고장" in text:
        return None, extract.failure("invalid_format")
    return extract.parse(text, json.dumps({"events": keyword_events(text)}, ensure_ascii=False))


@pytest.fixture
def ai(monkeypatch):
    monkeypatch.setattr(memos_router.extract, "extract", fake_ai)


def write(c, text, d, **kw):
    r = c.post("/memos", json={"text": text, "record_date": d, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def confirm(c, m, events=None, manual=False):
    r = c.post(
        f"/memos/{m['memo_id']}/confirm", json={"events": m["events"] if events is None else events, "manual": manual}
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_full_lifecycle_moves_summary_numbers(client, ai):
    c = client
    assert c.post("/visits", json={"visit_date": "2026-07-01", "status": "completed"}).status_code == 201
    assert c.post("/visits", json={"visit_date": "2026-07-15", "status": "completed"}).status_code == 201
    ids = {}
    for i, d in enumerate(days("2026-07-01", "2026-07-28")):  # 기준 14일(불안 없음) · 이번 14일(5일 불안)
        text = "밤에깸 불안x2" if d >= "2026-07-15" and i % 3 == 0 else "밤에깸 불안없음"
        ids[d] = confirm(c, write(c, text, d, request_id=f"r-{d}"))["memo_id"]
    anx = lambda: row(get_summary(c, "2026-07-28"), "anxiety")  # noqa: E731
    r = anx()
    assert (r["mark"], r["occurrence_days"], r["baseline_occurrence_days"], r["weekly_count"]) == ("new", 5, 0, 5.0)

    # 정정: 기준 구간 하루에 불안을 넣음 → 새로 나타남이 아니고, 5/14 vs 1/14는 증가 기준선(≈0.34) 이상
    m = c.get("/memos", params={"from": "2026-07-02", "to": "2026-07-02"}).json()[0]
    fixed = confirm(c, m, [dict(m["events"][1], status="present", evidence="불안")])
    assert [x["kind"] for x in c.get(f"/memos/{fixed['memo_id']}/revisions").json()] == ["정정", "최초 확인"]
    r = anx()
    assert (r["mark"], r["baseline_occurrence_days"]) == ("increase", 1)

    # 같은 내용으로 다시 확정 → 이력 늘지 않음
    confirm(c, fixed, [{k: v for k, v in e.items()} for e in fixed["events"]])
    assert len(c.get(f"/memos/{fixed['memo_id']}/revisions").json()) == 2

    # 원문 수정 → 확인 전으로 돌아가 요약에서 빠지고, 제외 목록에 들어감
    up = c.patch(f"/memos/{ids['2026-07-15']}", json={"text": "밤에깸 불안없음 오후엔 편안"}).json()
    assert up["status"] == "pending" and all(e["model_event_index"] is not None for e in up["events"])
    s = get_summary(c, "2026-07-28")
    assert s["exclusions"]["pending_memo_ids"] == [ids["2026-07-15"]] and s["coverage"]["recorded_days"] == 13
    assert row(s, "anxiety")["mark"] == "insufficient"  # 이번 기록일 13 < 14

    # 삭제 → 날짜 자체가 빠짐, 사건·이력도 같이 사라짐
    assert c.delete(f"/memos/{ids['2026-07-15']}").status_code == 204
    s = get_summary(c, "2026-07-28")
    assert s["exclusions"]["pending_memo_ids"] == [] and s["coverage"] == {"recorded_days": 13, "total_days": 14}
    from app.db import Event, MemoRevision, SessionLocal

    with SessionLocal() as db:
        assert db.query(Event).filter_by(memo_id=ids["2026-07-15"]).count() == 0
        assert db.query(MemoRevision).filter_by(memo_id=ids["2026-07-15"]).count() == 0

    # 진료일을 지우면 기준 구간이 사라지고 첫 기록일부터 계산
    v = [x for x in c.get("/visits").json() if x["visit_date"] == "2026-07-15"][0]
    assert c.delete(f"/visits/{v['id']}").status_code == 204
    s = get_summary(c, "2026-07-28")
    assert (
        s["period"]["start"] == "2026-07-01" and s["baseline"] is None and row(s, "anxiety")["mark"] == "not_comparable"
    )


def test_failed_then_manual_then_retry_paths(client, ai):
    c = client
    m = write(c, "고장 불안", "2026-08-01")
    assert (m["status"], m["failure_code"], m["events"]) == ("failed", "invalid_format", [])
    s = get_summary(c, "2026-08-01")
    assert s["exclusions"]["failed_memo_ids"] == [m["memo_id"]] and s["coverage"]["recorded_days"] == 0
    card = {"type": "anxiety", "status": "present", "time_expr": None, "count": 1, "evidence": "불안"}
    assert c.post(f"/memos/{m['memo_id']}/confirm", json={"events": [card]}).json()["code"] == "memo_failed"
    bad = c.post(f"/memos/{m['memo_id']}/confirm", json={"events": [dict(card, model_event_index=0)], "manual": True})
    assert bad.json()["code"] == "invalid_model_index"
    done = confirm(c, m, [card], manual=True)
    assert done["status"] == "confirmed" and done["failure_code"] is None
    assert [x["kind"] for x in c.get(f"/memos/{m['memo_id']}/revisions").json()] == ["수동 확인"]
    assert row(get_summary(c, "2026-08-01"), "anxiety")["occurrence_days"] == 1
    assert c.post(f"/memos/{m['memo_id']}/retry").json()["code"] == "memo_not_failed"
    # 원문을 고쳐 AI가 되살아나면 pending → 확정 전까지 수동 정리 결과는 사라짐
    up = c.patch(f"/memos/{m['memo_id']}", json={"text": "불안x3"}).json()
    assert up["status"] == "pending" and up["events"][0]["count"] == 3
    assert row(get_summary(c, "2026-08-01"), "anxiety")["occurrence_days"] == 0


def test_event_add_rules(client, ai):
    c = client
    m = write(c, "배회 그리고 넘어짐 새벽에", "2026-08-02")
    ev = {
        "memo_id": m["memo_id"],
        "type": "fall",
        "status": "present",
        "time_expr": "새벽에",
        "count": 1,
        "evidence": "넘어짐",
    }
    assert c.post("/events", json=ev).json()["code"] == "memo_not_confirmed"
    confirm(c, m)
    for patch, code in (
        ({"evidence": "계단"}, "evidence_not_in_text"),
        ({"time_expr": "밤에"}, "time_not_in_text"),
        ({"model_event_index": 0}, "invalid_model_index"),
        ({"memo_id": 999}, "memo_not_found"),
    ):
        assert c.post("/events", json={**ev, **patch}).json()["code"] == code
    for patch in ({"count": 0}, {"evidence": ""}, {"type": "sleepy"}, {"extra": 1}):
        assert c.post("/events", json={**ev, **patch}).status_code == 422
    first = c.post("/events", json={**ev, "count": 2}).json()
    assert len(first["events"]) == 3  # 같은 유형·근거라도 횟수가 다르면 다른 사건
    assert len(c.post("/events", json={**ev, "count": 2}).json()["events"]) == 3  # 완전히 같으면 추가 안 함
    assert row(get_summary(c, "2026-08-02"), "fall")["weekly_count"] is None
    assert get_summary(c, "2026-08-02")["falls"] == ["2026-08-02"]


def test_confirm_index_rules(client, ai):
    c = client
    m = write(c, "밤에깸 배회 불안없음", "2026-08-03")
    url = f"/memos/{m['memo_id']}/confirm"
    e = m["events"]
    assert [x["model_event_index"] for x in e] == [0, 1, 2]
    assert c.post(url, json={"events": [dict(e[0], model_event_index=3)]}).json()["code"] == "invalid_model_index"
    assert c.post(url, json={"events": [e[0], dict(e[1], model_event_index=0)]}).json()["code"] == "invalid_model_index"
    assert c.post(url, json={"events": [dict(e[0], model_event_index=-1)]}).status_code == 422
    assert c.post(url, json={"events": [e[0]] * 101}).status_code == 422
    # 순서를 바꾸고 일부만 확정 + 직접 넣은 사건 섞기
    mixed = [
        e[2],
        dict(e[0], count=4),
        {
            "type": "fall",
            "status": "present",
            "time_expr": None,
            "count": 1,
            "evidence": "배회",
            "model_event_index": None,
        },
    ]
    got = confirm(c, m, mixed)
    assert [(x["type"], x["model_event_index"], x["count"]) for x in got["events"]] == [
        ("anxiety", 2, 1),
        ("night_waking", 0, 4),
        ("fall", None, 1),
    ]
    assert c.get("/memos").json()[0]["events"] == got["events"]


def test_idempotent_requests(client, ai):
    c = client
    a = write(c, "밤에깸", "2026-08-04", request_id="k1")
    assert write(c, "밤에깸", "2026-08-04", request_id="k1")["memo_id"] == a["memo_id"]
    for body, code in (
        ({"text": "밤에깸", "record_date": "2026-08-05"}, "request_conflict"),
        ({"text": "배회", "record_date": "2026-08-04"}, "request_conflict"),
    ):
        r = c.post("/memos", json={**body, "request_id": "k1"})
        assert (r.status_code, r.json()["code"]) == (409, code)
    b = write(c, "배회", "2026-08-04")
    url = f"/memos/{a['memo_id']}"
    assert c.patch(url, json={"text": "불안", "request_id": "u1"}).json()["text"] == "불안"
    assert c.patch(url, json={"text": "불안", "request_id": "u1"}).json()["status"] == "pending"  # 재전송
    assert (
        c.patch(f"/memos/{b['memo_id']}", json={"text": "불안", "request_id": "u1"}).json()["code"]
        == "request_conflict"
    )
    assert c.patch(url, json={"text": "불안", "request_id": "k1"}).json()["code"] == "request_conflict"  # 생성 키
    c.patch(url, json={"text": "배회x2"})  # 요청 번호 없이 다시 고침
    assert c.patch(url, json={"text": "불안", "request_id": "u1"}).json()["code"] == "request_conflict"
    c.delete(url)
    assert c.patch(url, json={"text": "불안", "request_id": "u1"}).json()["code"] == "request_deleted"
    assert (
        c.post("/memos", json={"text": "밤에깸", "record_date": "2026-08-04", "request_id": "k1"}).json()["code"]
        == "request_deleted"
    )
    assert len(c.get("/memos").json()) == 1
    assert c.post("/memos", json={"text": "a", "record_date": "2026-08-04", "request_id": "x" * 101}).status_code == 422


def test_text_and_date_inputs(client, ai):
    c = client
    for text in ("가" * 1000, "😀" * 1000, '줄\n바꿈\t탭 "따옴표" <b>태그</b> \'; DROP TABLE memos;--'):
        assert write(c, text, TODAY.isoformat())["text"] == text
    for text in ("가" * 1001, "", " \n\t "):
        assert c.post("/memos", json={"text": text, "record_date": "2026-08-01"}).status_code == 422
    for d in ("2026-02-29", "2026-8-1", None, "0000-01-01"):
        assert c.post("/memos", json={"text": "a", "record_date": d}).status_code == 422
    assert write(c, "윤일 불안", "2024-02-29")["events"][0]["evidence"] == "불안"
    assert write(c, "a", "0001-01-01")["record_date"] == "0001-01-01"
    assert c.post("/memos", json={"text": "a", "record_date": "2026-08-01", "memo_id": 1}).status_code == 422
    assert len(c.get("/memos").json()) == 5 and c.get("/memos/abc/revisions").status_code == 422
    order = [(m["record_date"], m["memo_id"]) for m in c.get("/memos").json()]
    assert order == sorted(order, reverse=True)
    assert [m["record_date"] for m in c.get("/memos", params={"from": "2024-02-29", "to": "2024-02-29"}).json()] == [
        "2024-02-29"
    ]


def test_emergency_flag_is_computed_from_text(client, ai):
    m = write(client, "밤에 넘어짐 머리를 부딪히심", "2026-08-06")
    assert m["emergency"]["matched"] and "119" in m["emergency"]["message"]
    up = client.patch(f"/memos/{m['memo_id']}", json={"text": "넘어짐 괜찮으심"}).json()
    assert up["emergency"] == {"matched": False, "message": None}


def test_schedule_edges_feed_the_report(client):
    c = client
    tomorrow = (TODAY + dt.timedelta(1)).isoformat()
    assert c.post("/visits", json={"visit_date": TODAY.isoformat(), "status": "completed"}).status_code == 201
    v = c.post("/visits", json={"visit_date": tomorrow}).json()
    assert c.patch(f"/visits/{v['id']}", json={"status": "completed"}).json()["code"] == "future_visit"
    assert c.patch("/visits/999", json={"status": "completed"}).json()["code"] == "visit_not_found"
    assert c.post("/visits", json={"visit_date": tomorrow, "status": "done"}).status_code == 422
    assert c.delete("/visits/999").json()["code"] == "visit_not_found"
    assert c.post("/visits", json={"visit_date": "2026-01-10", "status": "scheduled"}).status_code == 201
    past = [x for x in c.get("/visits").json() if x["visit_date"] == "2026-01-10"][0]
    assert get_summary(c, "2026-01-20")["baseline"] is None  # 예약만 된 진료는 구간을 나누지 않음
    assert c.patch(f"/visits/{past['id']}", json={"status": "completed"}).json()["status"] == "completed"
    assert get_summary(c, "2026-01-20")["period"]["start"] == "2026-01-10"
    assert c.patch(f"/visits/{past['id']}", json={"status": "scheduled"}).json()["status"] == "scheduled"

    for bad in (
        {"name": "  ", "change_type": "start", "change_date": "2026-01-12"},
        {"name": "a" * 101, "change_type": "start", "change_date": "2026-01-12"},
        {"name": "a", "change_type": "double", "change_date": "2026-01-12"},
    ):
        assert c.post("/medications", json=bad).status_code == 422
    base = {"name": "도네페질", "change_type": "start", "change_date": "2026-01-12"}
    first = c.post("/medications", json=base).json()
    assert c.post("/medications", json={**base, "name": " 도네페질 "}).json()["id"] == first["id"]
    assert c.post("/medications", json={**base, "change_type": "increase"}).status_code == 201
    assert c.post("/medications", json={**base, "change_date": "2026-01-13"}).status_code == 201
    assert [m["change_date"] for m in c.get("/medications").json()] == ["2026-01-12", "2026-01-12", "2026-01-13"]
    assert c.delete("/medications/999").json()["code"] == "medication_not_found"

    q = {"text": "약 바꾼 뒤 잠", "period_start": "2026-01-01", "period_end": "2026-01-10"}
    one = c.post("/questions", json=q).json()
    assert c.post("/questions", json=q).status_code == 200
    assert c.post("/questions", json={**q, "period_end": "2026-01-11"}).status_code == 201  # 기간 다르면 새 질문
    assert c.post("/questions", json={"text": q["text"]}).status_code == 201
    assert c.post("/questions", json={**q, "period_start": "2026-01-11"}).status_code == 422
    assert c.post("/questions", json={"text": "x", "period_end": "2026-01-10"}).status_code == 422
    assert c.post("/questions", json={"text": " "}).status_code == 422
    assert c.delete(f"/questions/{one['id']}").status_code == 204
    assert c.delete(f"/questions/{one['id']}").json()["code"] == "question_not_found"
    assert len(c.get("/questions").json()) == 2

    assert c.put("/patient", json={"alias": "가" * 51}).status_code == 422
    assert c.put("/patient", json={"alias": "가" * 50}).json()["alias"] == "가" * 50
    assert get_summary(c, TODAY.isoformat())["patient_alias"] == "가" * 50


def test_api_prefix_on_every_group(client, ai):
    c = client
    m = c.post("/api/memos", json={"text": "불안", "record_date": "2026-08-07"}).json()
    assert c.post(f"/api/memos/{m['memo_id']}/confirm", json={"events": m["events"]}).status_code == 200
    assert c.get("/api/summary", params={"as_of": "2026-08-07", "ai": "false"}).json() == get_summary(c, "2026-08-07")
    assert c.get("/apix/memos").status_code == 404


# ── 동시 요청 ─────────────────────────────────────────
@pytest.fixture
def async_app(monkeypatch, tmp_path):
    monkeypatch.setenv("ITDA_DB", str(tmp_path / "c.db"))
    from app.db import init_db
    from app.main import create_app

    app = create_app()
    init_db()
    return app


@pytest.mark.anyio
async def test_late_ai_result_for_old_text_is_dropped(monkeypatch, async_app):
    gate = asyncio.Event()

    async def gated(text):
        if text == "밤에깸":
            await gate.wait()  # 첫 원문의 정리가 늦게 끝남
        return await fake_ai(text)

    monkeypatch.setattr(memos_router.extract, "extract", gated)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=async_app), base_url="http://t") as c:
        create = asyncio.create_task(c.post("/memos", json={"text": "밤에깸", "record_date": "2026-08-08"}))
        await asyncio.sleep(0.2)
        up = (await c.patch("/memos/1", json={"text": "배회x2"})).json()
        assert up["events"][0]["type"] == "wandering_exit"
        gate.set()
        late = (await create).json()
        assert late["text"] == "배회x2" and [e["type"] for e in late["events"]] == ["wandering_exit"]
        assert [e["type"] for e in (await c.get("/memos")).json()[0]["events"]] == ["wandering_exit"]


@pytest.mark.anyio
async def test_delete_while_ai_is_running(monkeypatch, async_app):
    gate = asyncio.Event()

    async def gated(text):
        await gate.wait()
        return await fake_ai(text)

    monkeypatch.setattr(memos_router.extract, "extract", gated)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=async_app), base_url="http://t") as c:
        create = asyncio.create_task(c.post("/memos", json={"text": "불안", "record_date": "2026-08-09"}))
        await asyncio.sleep(0.2)
        assert (await c.delete("/memos/1")).status_code == 204
        gate.set()
        r = await create
        assert (r.status_code, r.json()["code"]) == (404, "memo_not_found")
        assert (await c.get("/memos")).json() == []


@pytest.mark.anyio
async def test_many_parallel_writes_and_reads(monkeypatch, async_app):
    async def jitter(text):
        await asyncio.sleep(random.random() / 20)
        return await fake_ai(text)

    monkeypatch.setattr(memos_router.extract, "extract", jitter)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=async_app), base_url="http://t") as c:
        dates = days("2026-06-01", "2026-06-30")
        made = await asyncio.gather(
            *(
                c.post("/memos", json={"text": f"밤에깸 불안x{i % 3 + 1}", "record_date": d, "request_id": f"p{d}"})
                for i, d in enumerate(dates * 2)  # 같은 요청을 두 번씩 동시에
            ),
            c.get("/summary", params={"as_of": "2026-06-30", "ai": "false"}),
        )
        assert all(r.status_code == 200 for r in made) and len({r.json()["memo_id"] for r in made[:-1]}) == 30
        memos = (await c.get("/memos")).json()  # 재전송 응답은 정리 전(카드 없음)일 수 있어 저장본으로 확정
        assert len(memos) == 30 and all(m["status"] == "pending" and len(m["events"]) == 2 for m in memos)
        await asyncio.gather(
            *(
                c.post(f"/memos/{m['memo_id']}/confirm", json={"events": m["events"]})
                for m in {m["memo_id"]: m for m in memos}.values()
            )
        )
        s = (await c.get("/summary", params={"as_of": "2026-06-30", "ai": "false"})).json()
    r = next(x for x in s["rows"] if x["type"] == "anxiety")
    assert s["coverage"]["recorded_days"] == 30 and r["occurrence_days"] == 30
    assert r["weekly_count"] is None and r["mark"] == "not_comparable"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/memos/{}/revisions"),
        ("delete", "/memos/{}"),
        ("post", "/memos/{}/retry"),
        ("patch", "/visits/{}"),
        ("delete", "/visits/{}"),
        ("delete", "/medications/{}"),
        ("delete", "/questions/{}"),
    ],
)
@pytest.mark.parametrize("bad", ["0", "-1", str(2**63), "9" * 30])
def test_out_of_range_ids_are_422_not_500(client, method, path, bad):
    body = {"status": "completed"} if path.startswith("/visits") and method == "patch" else None
    r = client.request(method, path.format(bad), json=body)
    assert r.status_code == 422, (method, path, bad, r.status_code)
