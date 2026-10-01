"""명세 v3 계산 규칙의 경계 사례. (v2의 시간 표현→날짜 규칙은 프론트 계약에 따라 없어짐)"""
import math

import pytest

from itda.report import CFG, mark_for, periods, rows, weeks


def memo(i, day, status="확인 완료", events=()):
    return {"memo_id": i, "record_date": day, "status": status,
            "events": [{"type": t, "status": s, "count": c} for t, s, c in events]}


V = [{"visit_date": "2026-05-21", "status": "완료"}, {"visit_date": "2026-08-20", "status": "완료"}]


def test_recorded_day_is_confirmed_memo_date():
    """기록일 = 확인 완료 메모의 서로 다른 record_date. 사건 0개도 기록일, 확인 대기·정리 실패는 아님, 같은 날 여러 메모는 하루."""
    ms = [memo(1, "2026-09-01"), memo(2, "2026-09-01", events=[("야간 각성", "있었음", 2)]),
          memo(3, "2026-09-02", "확인 대기", [("낙상", "있었음", 1)]), memo(4, "2026-09-03", "정리 실패")]
    cur, base, cov, rs = rows(ms, V, "2026-09-05")
    assert cov == 1
    night = next(r for r in rs if r["type"] == "야간 각성")
    assert night["occurrence_days"] == 1 and night["current_rate"] == 1.0
    assert next(r for r in rs if r["type"] == "낙상")["occurrence_days"] == 0


def test_baseline_without_records_does_not_crash():
    ms = [memo(i, f"2026-09-{i:02d}") for i in range(1, 20)]
    _, base, _, rs = rows(ms, V, "2026-09-25")
    assert base is not None and {r["mark"] for r in rs} == {"비교 불가"}
    assert all(r["baseline_rate"] is None for r in rs)


def test_small_baseline_blocked_by_server_rule():
    ms = [memo(99, "2026-06-01")] + [memo(i, f"2026-09-{i:02d}", events=[("불안", "있었음", 1)]) for i in range(1, 20)]
    loose = next(r for r in rows(ms, V, "2026-09-25")[3] if r["type"] == "불안")["mark"]
    strict = next(r for r in rows(ms, V, "2026-09-25", cfg=dict(CFG, min_baseline_recorded_days=14))[3] if r["type"] == "불안")["mark"]
    assert loose == "새로 나타남" and strict == "비교 불가"


def test_current_under_14_days_is_insufficient():
    ms = [memo(i, f"2026-06-{i:02d}") for i in range(1, 29)] + [memo(100 + i, f"2026-09-{i:02d}") for i in range(1, 10)]
    assert {r["mark"] for r in rows(ms, V, "2026-09-25")[3]} == {"기록 부족"}


def test_period_start_override_and_scheduled_visit():
    vs = V + [{"visit_date": "2026-10-05", "status": "예정"}]
    cur, base = periods(vs, [], "2026-10-10")
    assert cur == {"start": "2026-08-20", "end": "2026-10-10"} and base == {"start": "2026-05-21", "end": "2026-08-19"}
    cur, base = periods(vs, [], "2026-09-27", "2026-09-01")
    assert cur["start"] == "2026-09-01" and base == {"start": "2026-08-20", "end": "2026-08-31"}


def test_no_visit_starts_at_first_confirmed_record():
    cur, base = periods([], [memo(1, "2026-07-03"), memo(2, "2026-07-01", "확인 대기")], "2026-09-27")
    assert cur == {"start": "2026-07-03", "end": "2026-09-27"} and base is None


def test_weeks_are_monday_to_sunday_and_split_at_period_edges():
    cur, base = periods(V, [], "2026-09-27")
    ws = weeks([], "야간 각성", cur, base)
    assert ws[0]["start"] == "2026-05-21" and ws[0]["end"] == "2026-05-24"  # 목~일
    assert ws[1]["start"] == "2026-05-25"                                     # 월
    last_base = [w for w in ws if w["period"] == "baseline"][-1]
    assert last_base["end"] == "2026-08-19" and [w for w in ws if w["period"] == "current"][0]["start"] == "2026-08-20"
    assert all(w["rate"] is None and w["low_coverage"] for w in ws)


def test_control_limit_example_from_plan():
    """기획안 3-4: 기준 10%, 기록일 60일 → 60일 중 13일부터 증가. 20일이면 7일부터."""
    assert mark_for(0.1, 12, 60, 60) is None and mark_for(0.1, 13, 60, 60) == "증가"
    assert mark_for(0.1, 6, 20, 60) is None and mark_for(0.1, 7, 20, 60) == "증가"


def js_round(x):
    return math.floor(x + 0.5)


@pytest.mark.parametrize("n", range(1, 201))
def test_percent_same_in_sentence_and_table(n):
    """서버는 응답에 넣는 rate(소수 넷째 자리)로 문장 %를 만들고, 프론트는 Math.round(rate*100)."""
    for k in range(n + 1):
        sent = round(k / n, 4)
        assert int(sent * 100 + 0.5) == js_round(sent * 100)
