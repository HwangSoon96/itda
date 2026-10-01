"""명세 v3 규칙(itda/report.py)이 프론트 목 서버와 같은 숫자를 내는지.

/tmp/itda/mock_dump.json = 프론트 mockApi를 데모 데이터로 돌린 결과 (vitest 덤프).
프론트 화면은 서버 숫자를 그대로 보여 주므로, 목 서버와 같으면 실제 서버를 붙여도 화면이 같게 나옴.
"""
import json
import os

import pytest

from itda.report import rows, summary_core, weeks

DUMP = "/tmp/itda/mock_dump.json"
pytestmark = pytest.mark.skipif(not os.path.exists(DUMP), reason="프론트 목 덤프 없음")


@pytest.fixture(scope="module")
def dump():
    return json.load(open(DUMP, encoding="utf-8"))


def close(a, b):
    return (a is None and b is None) or (a is not None and b is not None and abs(a - b) < 1e-9)


ROW_KEYS = ["mark", "evidence_dates", "memo_ids", "occurrence_days", "recorded_days", "mentioned_days",
            "absent_days", "unmentioned_days", "baseline_recorded_days", "baseline_occurrence_days",
            "baseline_mentioned_days", "baseline_absent_days", "baseline_unmentioned_days"]


@pytest.mark.parametrize("key", ["2026-09-27|", "2026-09-27|2026-09-01", "2026-08-25|", "2026-08-20|"])
def test_summary_matches_mock(dump, key):
    as_of, start = key.split("|")
    mock = dump["cases"][key]["summary"]
    mine = summary_core(dump, as_of, start or None)
    assert mine["period"] == mock["period"] and mine["baseline"] == mock["baseline"]
    assert mine["coverage"] == mock["coverage"] and mine["baseline_coverage"] == mock["baseline_coverage"]
    assert mine["exclusions"] == mock["exclusions"]
    assert mine["falls"] == mock["falls"] and mine["medications"] == mock["medications"] and mine["questions"] == mock["questions"]
    assert mine["trend_types"] == [t["type"] for t in mock["trends"]]
    for a, b in zip(mine["rows"], mock["rows"], strict=True):
        assert a["type"] == b["type"]
        for k in ("baseline_rate", "current_rate", "weekly_count"):
            assert close(a[k], b[k]), (a["type"], k, a[k], b[k])
        for k in ROW_KEYS:
            assert a[k] == b[k], (a["type"], k, a[k], b[k])


@pytest.mark.parametrize("key", ["2026-09-27|", "2026-09-27|2026-09-01", "2026-08-25|", "2026-08-20|"])
def test_trends_match_mock(dump, key):
    as_of, start = key.split("|")
    mock = dump["cases"][key]
    mine_cur, mine_base, _, _ = rows(dump["memos"], dump["visits"], as_of, start or None)
    for t, tr in mock["trends"].items():
        mine = weeks(dump["memos"], t, mine_cur, mine_base)
        assert len(mine) == len(tr["weeks"]), t
        for a, b in zip(mine, tr["weeks"]):
            assert {k: a[k] for k in ("start", "end", "period", "recorded_days", "event_days", "low_coverage")} == \
                   {k: b[k] for k in ("start", "end", "period", "recorded_days", "event_days", "low_coverage")}, (t, a, b)
            assert close(a["rate"], b["rate"])


def test_no_visit_still_gives_summary(dump):
    """v2의 409 no_visit는 없어짐: 진료일이 없으면 첫 확인 기록일부터."""
    data = dict(dump, visits=[])
    mock = dump["cases"]["novisit|2026-09-27"]["summary"]
    mine = summary_core(data, "2026-09-27")
    assert mine["period"] == mock["period"] and mine["baseline"] is None and mock["baseline"] is None


def test_scheduled_visit_is_not_a_period_boundary(dump):
    """다음 예약(10/5)은 구간을 나누지 않음. 기준일을 10/6으로 옮겨도 마지막 받은 진료 8/20부터."""
    cur, base, _, _ = rows(dump["memos"], dump["visits"], "2026-10-06")
    assert cur["start"] == "2026-08-20" and base["start"] == "2026-05-21"


def test_tiny_baseline_gives_new_in_mock(dump):
    """D02: 기준 구간 기록이 적어도 목 서버는 '새로 나타남'을 붙임 → 서버 규칙(14일)으로 막음."""
    from itda.report import CFG
    memos = [m for m in dump["memos"] if not ("2026-05-22" <= m["record_date"] <= "2026-08-18")]
    loose = {r["type"]: r["mark"] for r in rows(memos, dump["visits"], "2026-09-27")[3]}
    strict = {r["type"]: r["mark"] for r in rows(memos, dump["visits"], "2026-09-27", cfg=dict(CFG, min_baseline_recorded_days=14))[3]}
    assert "새로 나타남" in loose.values() or "증가" in loose.values()
    assert set(strict.values()) == {"비교 불가"}
