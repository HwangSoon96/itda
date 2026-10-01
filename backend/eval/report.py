"""평가 3가지를 실제 코드·모델로 다시 재서 eval/results/에 남김.

  uv run python eval/report.py signal                 # 증가 표시: σ3·σ2 탐지율·오경보율 (모델 불필요)
  uv run python eval/report.py summary [--cpu]        # 요약 검사 통과율·떨어진 이유·시간 (Ollama 필요)
  uv run python eval/report.py correct [--n 20]       # 수정 비율: 켜 둔 서버(127.0.0.1:8000)에 데모 메모 입력·확인 완료

signal_scenarios.json은 ai/ml/eval/에서 가져옴 (ITDA_AI 환경변수로 위치 변경).
"""

import argparse
import asyncio
import collections
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import stats, summarize  # noqa: E402
from app.settings import labels, settings  # noqa: E402

OUT = ROOT / "eval" / "results"
SCEN = Path(os.environ.get("ITDA_AI", ROOT.parent / "ai")) / "ml" / "eval" / "signal_scenarios.json"
TYPES = list(labels()["type"])
KO = {v: k for k, v in labels()["type"].items()}
ST = {v: k for k, v in labels()["status"].items()}


def scenario_world(s):
    """기록일마다 확인 완료 메모 하나, 사건은 그날 메모에 붙임."""
    by_day = {d: [] for d in s["recorded_days"]}
    for e in s["events"]:
        by_day.setdefault(e["event_date"], []).append(e)
    memos = [
        {"memo_id": i, "record_date": d, "status": "confirmed", "events": evs}
        for i, (d, evs) in enumerate(sorted(by_day.items()), 1)
    ]
    return memos, [{"visit_date": v, "status": "completed"} for v in s["visits"]]


def demo_world():
    memos = json.loads((ROOT / "demo" / "demo_memos.json").read_text(encoding="utf-8"))
    events = json.loads((ROOT / "demo" / "demo_events.json").read_text(encoding="utf-8"))
    ctx = json.loads((ROOT / "demo" / "demo_context.json").read_text(encoding="utf-8"))
    evs = collections.defaultdict(list)
    for e in events:
        evs[e["memo_id"]].append({"type": KO[e["type"]], "status": ST[e["status"]], "count": e["count"]})
    world = [
        {"memo_id": m["id"], "record_date": m["record_date"], "status": "confirmed", "events": evs[m["id"]]}
        for m in memos
        if m["status"] == "확인 완료"
    ]
    visits = [{"visit_date": v["visit_date"], "status": "completed"} for v in ctx["visits"] if v["status"] == "완료"]
    return world, visits, ctx["as_of"]


# ── 증가 표시 ──────────────────────────────────────
def signal():
    scen = json.loads(SCEN.read_text(encoding="utf-8"))
    out = {"source": str(SCEN), "patients": len(scen), "unit": "환자 × 유형", "by_sigma": {}}
    for sigma in (3, 2):
        cfg = dict(settings(), sigma=sigma)
        hit = miss = fa = neg = fa_c = neg_c = 0
        kind_ok, detail = 0, []
        for s in scen:
            memos, visits = scenario_world(s)
            _, _, _, rows = stats.rows(memos, visits, TYPES, s["as_of"], None, cfg)
            mark = {r["type"]: r["mark"] for r in rows}
            planted = {c["type"]: c["kind"] for c in s["planted_changes"]}
            seen = {e["type"] for e in s["events"]}
            for t in seen | set(planted):
                flagged = mark[t] in ("increase", "new")
                if t in planted:
                    hit += flagged
                    miss += not flagged
                    kind_ok += mark[t] == planted[t]
                    detail.append({"patient": s["patient_id"], "type": t, "planted": planted[t], "mark": mark[t]})
                elif s["planted"]:  # 변화 심은 환자의 다른 유형
                    fa_c += flagged
                    neg_c += 1
                else:
                    fa += flagged
                    neg += 1
                    if flagged:
                        detail.append({"patient": s["patient_id"], "type": t, "planted": None, "mark": mark[t]})
        out["by_sigma"][sigma] = {
            "탐지": f"{hit}/{hit + miss}",
            "탐지율": round(hit / (hit + miss), 3),
            "종류까지 맞음(증가/새로)": f"{kind_ok}/{hit + miss}",
            "오경보(변화 안 심은 20명)": f"{fa}/{neg}",
            "오경보율": round(fa / neg, 3),
            "참고: 변화 심은 환자의 다른 유형 오경보": f"{fa_c}/{neg_c}",
            "놓치거나 헛표시한 건": [
                d for d in detail if (d["planted"] is None) or d["mark"] not in ("increase", "new")
            ],
        }
    return out


# ── 요약 검사 ──────────────────────────────────────
class CpuClient:
    """요약 모델을 GPU 없이 부름 (num_gpu 0)."""

    base = summarize.AsyncClient

    def __init__(self, **kw):
        self.c = self.base(**kw)

    async def chat(self, **kw):
        kw["options"] = {**kw.get("options", {}), "num_gpu": 0}
        return await self.c.chat(**kw)


async def summary(cpu: bool, limit: int | None):
    scen = json.loads(SCEN.read_text(encoding="utf-8"))
    cases = [(s["patient_id"], *scenario_world(s), s["as_of"]) for s in scen]
    cases.append(("DEMO", *demo_world()))
    if limit:
        cases = cases[:limit]
    attempts: list[list[str]] = []
    real_check = summarize.check

    def spy(lines, fx, rows, falls):
        why = real_check(lines, fx, rows, falls)
        attempts[-1].append(why)
        return why

    summarize.check = spy
    if cpu:
        summarize.AsyncClient = CpuClient
    cfg, results = settings(), []
    warm = cases[0]
    for name, memos, visits, as_of in [("warmup", *warm[1:])] + cases:
        cur, base, cov, rows = stats.rows(memos, visits, TYPES, as_of, None, cfg)
        fall = next(r for r in rows if r["type"] == "fall")
        if not (summarize.signals(rows) or fall["_occ"]):
            if name != "warmup":
                results.append({"case": name, "source": "template", "llm_called": False})
            continue
        attempts.append([])
        t = time.perf_counter()
        sent = await summarize.llm(rows, fall["_occ"], fall, cov, cur, base)
        sec = time.perf_counter() - t
        if name == "warmup":
            continue
        results.append(
            {
                "case": name,
                "source": "llm" if sent else "template",
                "llm_called": True,
                "seconds": round(sec, 2),
                "attempts": attempts[-1] or [["호출 실패(연결·시간 초과)"]],
                "sentences": [x["text"] for x in sent] if sent else None,
            }
        )
    called = [r for r in results if r["llm_called"]]
    ok = [r for r in called if r["source"] == "llm"]
    reasons = collections.Counter(w for r in called for a in r["attempts"] for w in a)
    first_fail = collections.Counter(w for r in called for w in r["attempts"][0])
    secs = [r["seconds"] for r in called]
    return {
        "model": cfg["summary_model"],
        "device": "CPU (num_gpu 0)" if cpu else "GPU",
        "요약지 계산": len(results),
        "모델 호출(증가·새로 나타남·낙상 있음)": len(called),
        "llm 통과": f"{len(ok)}/{len(called)}",
        "통과율": round(len(ok) / len(called), 3) if called else None,
        "첫 시도 통과": sum(r["attempts"][0] == [] for r in called),
        "시도별 떨어진 이유(전체)": dict(reasons),
        "첫 시도 떨어진 이유": dict(first_fail),
        "시간(초) 평균/최대/최소": [round(sum(secs) / len(secs), 1), max(secs), min(secs)] if secs else None,
        "cases": results,
    }


# ── 수정 비율 ──────────────────────────────────────
def api(method, path, body=None, base="http://127.0.0.1:8000"):
    req = urllib.request.Request(
        base + path,
        method=method,
        data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read() or "null")


def correct(n: int):
    memos = json.loads((ROOT / "demo" / "demo_memos.json").read_text(encoding="utf-8"))
    gold = collections.defaultdict(list)
    for e in json.loads((ROOT / "demo" / "demo_events.json").read_text(encoding="utf-8")):
        gold[e["memo_id"]].append(
            {
                "type": KO[e["type"]],
                "status": ST[e["status"]],
                "time_expr": e["time_expr"],
                "count": e["count"],
                "evidence": e["evidence"],
            }
        )
    step = len(memos) / n
    pick = [memos[int(i * step)] for i in range(n)]  # 기간 전체에서 고르게
    rows, tally = [], collections.Counter()
    for m in pick:
        t = time.perf_counter()
        res = api("POST", "/memos", {"text": m["text"], "record_date": m["record_date"]})
        sec = time.perf_counter() - t
        cards, want = res["events"], gold[m["id"]]
        final, used, acts = [], set(), []
        for g in want:  # 정답 사건마다 같은 유형·있었음/없었음 카드를 찾아 그대로 두거나 고침
            j = next(
                (
                    i
                    for i, c in enumerate(cards)
                    if i not in used and (c["type"], c["status"]) == (g["type"], g["status"])
                ),
                None,
            )
            if j is None:
                final.append({**g, "model_event_index": None})
                acts.append(f"추가 {g['type']}/{g['status']}")
                continue
            used.add(j)
            c = cards[j]
            fixed = {k: g[k] for k in ("count", "time_expr") if c[k] != g[k]}
            final.append({**c, **fixed})
            acts.append(f"고침 {g['type']} {fixed}" if fixed else "그대로")
        acts += [f"삭제 {c['type']}/{c['status']}" for i, c in enumerate(cards) if i not in used]
        if res["status"] == "failed":
            done = api("POST", f"/memos/{res['memo_id']}/confirm", {"events": final, "manual": True})
        else:
            done = api("POST", f"/memos/{res['memo_id']}/confirm", {"events": final})
        assert done["status"] == "confirmed"
        kinds = collections.Counter(a.split()[0] for a in acts)
        tally.update(kinds)
        rows.append(
            {
                "memo_id": res["memo_id"],
                "demo_id": m["id"],
                "record_date": m["record_date"],
                "ai_status": res["status"],
                "seconds": round(sec, 1),
                "ai_cards": len(cards),
                "gold": len(want),
                "actions": acts,
                "edited": any(a != "그대로" for a in acts),
            }
        )
    edited = sum(r["edited"] for r in rows)
    touched = tally["고침"] + tally["삭제"] + tally["추가"]
    total = tally["그대로"] + tally["고침"] + tally["추가"]
    secs = [r["seconds"] for r in rows]
    return {
        "model": settings()["model_name"],
        "메모": n,
        "AI 정리 실패": sum(r["ai_status"] == "failed" for r in rows),
        "고친 메모": f"{edited}/{n}",
        "메모 수정 비율": round(edited / n, 3),
        "사건 처리": dict(tally),
        "사건 수정 비율(고침+삭제+추가 / 최종 사건+삭제)": f"{touched}/{total + tally['삭제']}",
        "정리 시간(초) 평균/최대": [round(sum(secs) / n, 1), max(secs)],
        "memos": rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["signal", "summary", "correct"])
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--n", type=int, default=20)
    a = ap.parse_args()
    if a.what == "signal":
        res, name = signal(), "signal"
    elif a.what == "summary":
        res, name = asyncio.run(summary(a.cpu, a.limit)), f"summary_{'cpu' if a.cpu else 'gpu'}"
    else:
        res, name = correct(a.n), "correct"
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in res.items() if k not in ("cases", "memos")}, ensure_ascii=False, indent=1))
    print("저장:", path)


if __name__ == "__main__":
    main()
