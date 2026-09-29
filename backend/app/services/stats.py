"""요약지·경과 계산 (명세 6장). 프론트 목 서버와 같은 숫자를 내도록 대조 검증한 규칙.

입력은 DB와 무관한 dict:
  memos: [{memo_id, record_date(ISO), status(code), events: [{type, status, count}]}]  events는 확정 사건
  visits: [{visit_date, status}]
"""

import datetime as dt
import math

D = dt.date.fromisoformat


def shift(s: str, n: int) -> str:
    return (D(s) + dt.timedelta(days=n)).isoformat()


def ndays(a: str, b: str) -> int:
    return (D(b) - D(a)).days + 1


def periods(visits, memos, as_of: str, period_start: str | None = None):
    """이번 구간 시작 = period_start → as_of 이전 마지막 받은 진료 → 첫 확인 기록일 → as_of.
    기준 구간 = 시작보다 앞선 마지막 받은 진료 ~ 시작 전날. 다음 예약은 구간을 나누지 않음."""
    done = sorted(v["visit_date"] for v in visits if v["status"] == "completed" and v["visit_date"] <= as_of)
    known = sorted(m["record_date"] for m in memos if m["status"] == "confirmed" and m["record_date"] <= as_of)
    start = period_start or (done[-1] if done else None) or (known[0] if known else None) or as_of
    prev = [v for v in done if v < start]
    base = {"start": prev[-1], "end": shift(start, -1)} if prev else None
    return {"start": start, "end": as_of}, base


def observe(memos, period, t=None):
    rec, pres, absn, ment, mids = set(), set(), set(), set(), set()
    ev_dates, p_dates, p_mids, cnt = set(), set(), set(), 0
    for m in memos:
        if m["status"] != "confirmed" or not (period["start"] <= m["record_date"] <= period["end"]):
            continue
        rec.add(m["record_date"])
        for e in m["events"]:
            if t and e["type"] != t:
                continue
            ment.add(m["record_date"])
            mids.add(m["memo_id"])
            ev_dates.add(m["record_date"])
            if e["status"] == "present":
                pres.add(m["record_date"])
                cnt += e["count"]
                p_dates.add(m["record_date"])
                p_mids.add(m["memo_id"])
            else:
                absn.add(m["record_date"])
    absn -= pres
    return {
        "recorded": rec,
        "present": pres,
        "absent": absn,
        "mentioned": ment,
        "memo_ids": mids,
        "evidence_dates": ev_dates,
        "present_dates": p_dates,
        "present_memo_ids": p_mids,
        "count": cnt,
    }


def mark_for(base_rate, cur_days, n_cur, n_base, cfg):
    if base_rate is None or n_base < cfg["min_baseline_recorded_days"]:
        return "not_comparable"
    if n_cur < cfg["min_recorded_days"]:
        return "insufficient"
    if base_rate == 0 and cur_days > 0:
        return "new"
    upper = base_rate + cfg["sigma"] * math.sqrt(base_rate * (1 - base_rate) / n_cur)
    if cur_days >= cfg["min_event_days"] and cur_days / n_cur > upper:
        return "increase"
    return None


def r4(x):
    return None if x is None else round(x, 4)


def rows(memos, visits, types, as_of, period_start, cfg):
    cur, base = periods(visits, memos, as_of, period_start)
    cov = len(observe(memos, cur)["recorded"])
    out = []
    for t in types:
        c = observe(memos, cur, t)
        b = observe(memos, base, t) if base else None
        n_base = len(b["recorded"]) if b else 0
        cur_rate = len(c["present"]) / cov if cov else None
        base_rate = len(b["present"]) / n_base if n_base else None
        mark = mark_for(base_rate, len(c["present"]), cov, n_base, cfg)
        enough = mark not in ("insufficient", "not_comparable")
        out.append(
            {
                "type": t,
                "baseline_rate": r4(base_rate),
                "current_rate": r4(cur_rate),
                "weekly_count": round(c["count"] / cov * 7, 1) if cov and enough else None,
                "mark": mark,
                "evidence_dates": sorted((b["evidence_dates"] if b else set()) | c["evidence_dates"]),
                "memo_ids": sorted((b["memo_ids"] if b else set()) | c["memo_ids"]),
                "occurrence_days": len(c["present"]),
                "recorded_days": cov,
                "mentioned_days": len(c["mentioned"]),
                "absent_days": len(c["absent"]),
                "unmentioned_days": cov - len(c["mentioned"]),
                "baseline_recorded_days": n_base,
                "baseline_occurrence_days": len(b["present"]) if b else 0,
                "baseline_mentioned_days": len(b["mentioned"]) if b else 0,
                "baseline_absent_days": len(b["absent"]) if b else 0,
                "baseline_unmentioned_days": (n_base - len(b["mentioned"])) if b else 0,
                # 문장용 (응답에서 뺌)
                "_occ": sorted(c["present"]),
                "_cur_dates": sorted(c["present_dates"]),
                "_cur_mids": sorted(c["present_memo_ids"]),
                "_raw_cur": cur_rate,
                "_raw_base": base_rate,
            }
        )
    return cur, base, cov, out


def weeks(memos, t, cur, base, cfg):
    out = []
    for per, kind in ((base, "baseline"), (cur, "current")):
        if not per:
            continue
        s = per["start"]
        while s <= per["end"]:
            e = min(shift(s, (7 - D(s).isoweekday() % 7) % 7), per["end"])  # 그 주 일요일 또는 구간 끝
            o = observe(memos, {"start": s, "end": e}, t)
            n = len(o["recorded"])
            low = n < cfg["low_coverage_week_days"]
            out.append(
                {
                    "start": s,
                    "end": e,
                    "period": kind,
                    "rate": None if low else r4(len(o["present"]) / n),
                    "recorded_days": n,
                    "event_days": len(o["present"]),
                    "low_coverage": low,
                }
            )
            s = shift(e, 1)
    return out


def trend_types(rws, memos, base, cfg):
    has_base = base is not None and len(observe(memos, base)["recorded"]) > 0
    cand = [r for r in rws if max(r["occurrence_days"], r["baseline_occurrence_days"]) >= cfg["trend_min_days"]]

    def mag(r):
        if has_base:
            return abs((r["_raw_cur"] or 0) - (r["_raw_base"] or 0))
        return r["_raw_cur"] or 0

    return [r["type"] for r in sorted(cand, key=mag, reverse=True)[: cfg["trend_top_n"]]]
