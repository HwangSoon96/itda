"""명세 v3 통계 규칙 (프론트 itda-frontend 계약 기준).

v2와 달라진 점
- 날짜: 사건마다 날짜를 계산하지 않음. 메모의 record_date(보호자가 고른 날)가 그 메모 모든 사건의 날짜.
- 기록일: 기간 안 '확인 완료' 메모의 서로 다른 record_date. (사건이 없어도 확인 완료면 기록일)
- 진료일: status가 completed(받은 진료)인 것만 구간 계산에 씀. scheduled(다음 예약)는 제외.
- 구간: 시작 = period_start(선택) → 없으면 기준일 이전(포함) 마지막 받은 진료 → 없으면 첫 확인 기록일 → 없으면 기준일.
        기준 구간 = 시작보다 앞선 마지막 받은 진료 ~ 시작 전날. 없으면 null.
- 진료일이 없어도 요약지는 나옴(no_visit 오류 없음).
"""
import datetime as dt
import math

TYPES = ["야간 각성", "배회·출입문 시도", "초조·공격", "과민·짜증", "불안", "우울·무기력",
         "망상", "환각", "식사량 감소", "복약 거부", "사람·장소 혼동", "낙상"]
CFG = dict(min_recorded_days=14, min_baseline_recorded_days=0, min_event_days=3, sigma=3,
           low_coverage_week_days=4, trend_top_n=3, trend_min_days=3)
D = dt.date.fromisoformat


def shift(s, n):
    return (D(s) + dt.timedelta(days=n)).isoformat()


def ndays(a, b):
    return (D(b) - D(a)).days + 1


def periods(visits, memos, as_of, period_start=None):
    done = sorted(v["visit_date"] for v in visits if v["status"] in ("완료", "completed") and v["visit_date"] <= as_of)
    known = sorted(m["record_date"] for m in memos if m["status"] in ("확인 완료", "confirmed") and m["record_date"] <= as_of)
    start = period_start or (done[-1] if done else None) or (known[0] if known else None) or as_of
    prev = [v for v in done if v < start]
    base = {"start": prev[-1], "end": shift(start, -1)} if prev else None
    return {"start": start, "end": as_of}, base


def observe(memos, period, t=None):
    rec, pres, absn, ment, mids = set(), set(), set(), set(), set()
    ev_dates, p_dates, p_mids, cnt = set(), set(), set(), 0
    for m in memos:
        if m["status"] not in ("확인 완료", "confirmed") or not (period["start"] <= m["record_date"] <= period["end"]):
            continue
        rec.add(m["record_date"])
        for e in m["events"]:
            if t and e["type"] != t:
                continue
            ment.add(m["record_date"]); mids.add(m["memo_id"]); ev_dates.add(m["record_date"])
            if e["status"] in ("있었음", "present"):
                pres.add(m["record_date"]); cnt += e["count"]; p_dates.add(m["record_date"]); p_mids.add(m["memo_id"])
            else:
                absn.add(m["record_date"])
    absn -= pres
    return dict(recorded=rec, present=pres, absent=absn, mentioned=ment, memo_ids=mids,
                evidence_dates=ev_dates, present_dates=p_dates, present_memo_ids=p_mids, count=cnt)


def mark_for(base_rate, cur_days, n_cur, n_base, cfg=CFG):
    if base_rate is None or n_base < cfg["min_baseline_recorded_days"]:
        return "비교 불가"
    if n_cur < cfg["min_recorded_days"]:
        return "기록 부족"
    if base_rate == 0 and cur_days > 0:
        return "새로 나타남"
    upper = base_rate + cfg["sigma"] * math.sqrt(base_rate * (1 - base_rate) / n_cur)
    if cur_days >= cfg["min_event_days"] and cur_days / n_cur > upper:
        return "증가"
    return None


def rows(memos, visits, as_of, period_start=None, cfg=CFG):
    cur, base = periods(visits, memos, as_of, period_start)
    cov = len(observe(memos, cur)["recorded"])
    out = []
    for t in TYPES:
        c = observe(memos, cur, t)
        b = observe(memos, base, t) if base else None
        cur_rate = len(c["present"]) / cov if cov else None
        base_rate = len(b["present"]) / len(b["recorded"]) if b and b["recorded"] else None
        mark = mark_for(base_rate, len(c["present"]), cov, len(b["recorded"]) if b else 0, cfg)
        enough = mark not in ("기록 부족", "비교 불가")
        out.append(dict(
            type=t, baseline_rate=base_rate, current_rate=cur_rate,
            weekly_count=(c["count"] / cov) * 7 if cov and enough else None, mark=mark,
            evidence_dates=sorted((b["evidence_dates"] if b else set()) | c["evidence_dates"]),
            memo_ids=sorted((b["memo_ids"] if b else set()) | c["memo_ids"]),
            occurrence_days=len(c["present"]), recorded_days=cov,
            mentioned_days=len(c["mentioned"]), absent_days=len(c["absent"]), unmentioned_days=cov - len(c["mentioned"]),
            baseline_recorded_days=len(b["recorded"]) if b else 0, baseline_occurrence_days=len(b["present"]) if b else 0,
            baseline_mentioned_days=len(b["mentioned"]) if b else 0, baseline_absent_days=len(b["absent"]) if b else 0,
            baseline_unmentioned_days=(len(b["recorded"]) - len(b["mentioned"])) if b else 0,
            _occ=sorted(c["present"])))
    return cur, base, cov, out


def weeks(memos, t, cur, base, cfg=CFG):
    out = []
    for per, kind in ((base, "baseline"), (cur, "current")):
        if not per:
            continue
        s = per["start"]
        while s <= per["end"]:
            sunday = shift(s, (7 - D(s).isoweekday() % 7) % 7)
            e = min(sunday, per["end"])
            o = observe(memos, {"start": s, "end": e}, t)
            n = len(o["recorded"])
            out.append(dict(start=s, end=e, period=kind,
                            rate=len(o["present"]) / n if n >= cfg["low_coverage_week_days"] else None,
                            recorded_days=n, event_days=len(o["present"]), low_coverage=n < cfg["low_coverage_week_days"]))
            s = shift(e, 1)
    return out


def trend_types(rws, memos, base, cfg=CFG):
    has_base = base is not None and len(observe(memos, base)["recorded"]) > 0
    cand = [r for r in rws if r["occurrence_days"] >= cfg["trend_min_days"] or r["baseline_occurrence_days"] >= cfg["trend_min_days"]]
    mag = (lambda r: abs((r["current_rate"] or 0) - (r["baseline_rate"] or 0))) if has_base else (lambda r: r["current_rate"] or 0)
    return [r["type"] for r in sorted(cand, key=mag, reverse=True)[:cfg["trend_top_n"]]]


def summary_core(data, as_of, period_start=None, cfg=CFG):
    memos, visits, meds, qs = data["memos"], data["visits"], data["medications"], data["questions"]
    cur, base, cov, rws = rows(memos, visits, as_of, period_start, cfg)
    fall = next(r for r in rws if r["type"] == "낙상")
    sel = [m for m in memos if cur["start"] <= m["record_date"] <= cur["end"]]
    return dict(
        period=cur, baseline=base,
        coverage=dict(recorded_days=cov, total_days=ndays(cur["start"], cur["end"])),
        baseline_coverage=dict(recorded_days=len(observe(memos, base)["recorded"]), total_days=ndays(base["start"], base["end"])) if base else None,
        exclusions=dict(pending_memo_ids=sorted(m["memo_id"] for m in sel if m["status"] in ("확인 대기", "pending")),
                        failed_memo_ids=sorted(m["memo_id"] for m in sel if m["status"] in ("정리 실패", "failed"))),
        rows=rws, falls=fall["_occ"],
        medications=[dict(name=x["name"], change_type=x["change_type"], date=x["change_date"])
                     for x in sorted(meds, key=lambda x: (x["change_date"], x["id"])) if cur["start"] <= x["change_date"] <= cur["end"]],
        questions=[q["text"] for q in sorted(qs, key=lambda q: (q["created_at"], q["id"])) if cur["start"] <= q["created_at"][:10] <= cur["end"]],
        trend_types=trend_types(rws, memos, base, cfg),
    )
