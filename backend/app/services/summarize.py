"""핵심 요약: 문장 틀(template) 또는 요약 모델(llm) → 검사 6가지 → 떨어지면 문장 틀 (명세 6장).

문장 틀의 모양은 프론트 목 서버와 같다 ("낙상: 2026-09-09에 기록됨.").
"""

import json
import re

from ollama import AsyncClient

from ..settings import labels, ollama_host, settings
from .stats import ndays

PROMPT = """너는 치매 환자 보호자의 관찰 기록을 의사에게 전달하는 요약 문장을 쓴다.
아래 사실(JSON)만 사용해서 한국어로 3~5문장을 쓴다.
규칙:
- 사실에 없는 숫자, 날짜, 비율을 새로 만들지 않는다. 숫자는 사실에 적힌 그대로 쓴다.
- 원인을 해석하지 않는다(때문, 로 인해, 영향 같은 말 금지). 진단·단계·약 조언·안심 표현을 쓰지 않는다.
- 낙상이 있으면 가장 먼저 쓰고, 표시가 붙은 유형은 모두 쓴다.
- 문장은 "~됨." 으로 끝낸다. 번호나 기호 없이 한 줄에 한 문장.
- 아래 모양을 따른다(값만 바꿈):
  낙상: [날짜들]에 기록됨.
  [유형]: 기준 구간에는 기록이 없었고 이번 구간 [처음 기록된 날]에 처음 기록됨 (총 [발생일 수]일).
  [유형]: 발생일 비율이 기준 구간 [기준%]%에서 이번 구간 [이번%]%로 증가 표시됨 (기록일 [기록일 수]일 중 [발생일 수]일).
사실:
{facts}"""


def pct(rate: float | None) -> str:
    """V02: 응답에 넣은 비율(소수 넷째 자리)로 반올림. 프론트 Math.round와 같은 결과."""
    p = (rate or 0) * 100
    return "<1" if 0 < p < 1 else str(int(p + 0.5))


def _ko(t: str) -> str:
    return labels()["type"][t]


def signals(rows):
    """낙상 제외, 새로 나타남 먼저, 그다음 비율 차이 큰 순."""
    flagged = [r for r in rows if r["type"] != "fall" and r["mark"] in ("increase", "new")]
    return sorted(flagged, key=lambda r: (r["mark"] != "new", -((r["_raw_cur"] or 0) - (r["_raw_base"] or 0))))


def template(rows, falls, fall_row, cov, cur, base, base_cov, coverage_sources):
    out = []
    if falls:
        more = f" 외 {len(falls) - 3}일" if len(falls) > 3 else ""
        out.append(
            {
                "scope": "current",
                "types": ["fall"],
                "text": f"낙상: {', '.join(falls[:3])}{more}에 기록됨.",
                "evidence_dates": fall_row["_cur_dates"],
                "memo_ids": fall_row["_cur_mids"],
            }
        )
    for r in signals(rows):
        if r["mark"] == "new":
            out.append(
                {
                    "scope": "current",
                    "types": [r["type"]],
                    "text": f"{_ko(r['type'])}: 기준 구간에는 기록이 없었고 이번 구간 {r['_occ'][0]}에 처음 기록됨 "
                    f"(총 {r['occurrence_days']}일).",
                    "evidence_dates": r["_cur_dates"],
                    "memo_ids": r["_cur_mids"],
                }
            )
        else:
            out.append(
                {
                    "scope": "comparison",
                    "types": [r["type"]],
                    "text": f"{_ko(r['type'])}: 발생일 비율이 기준 구간 {pct(r['baseline_rate'])}%에서 이번 구간 "
                    f"{pct(r['current_rate'])}%로 증가 표시됨 (기록일 {r['recorded_days']}일 중 "
                    f"{r['occurrence_days']}일).",
                    "evidence_dates": r["evidence_dates"],
                    "memo_ids": r["memo_ids"],
                }
            )
    total = _days(cur)
    if not out:
        comparable = any(r["mark"] not in ("not_comparable", "insufficient") for r in rows)
        msg = (
            "기준 구간 대비 증가 표시가 붙은 항목 없음."
            if comparable
            else "비교할 기록이 부족해 증가 표시를 계산하지 않음."
        )
        report = {"start": base["start"] if base else cur["start"], "end": cur["end"]}
        out.append(
            {
                "scope": "comparison",
                "types": [],
                "text": f"{msg} 전체 {total}일 중 {cov}일에 확인된 기록이 있음.",
                **coverage_sources(report),
            }
        )
    elif len(out) < 3:
        out.append(
            {
                "scope": "current",
                "types": [],
                "text": f"이번 구간 전체 {total}일 중 {cov}일에 확인된 기록이 있음.",
                **coverage_sources(cur),
            }
        )
        if len(out) < 3:
            text = (
                f"기준 구간 전체 {_days(base)}일 중 {base_cov}일에 확인된 기록이 있음."
                if base
                else "비교할 이전 진료 구간이 없어 증가와 새로 나타남 표시를 계산하지 않음."
            )
            out.append(
                {"scope": "baseline" if base else "comparison", "types": [], "text": text, **coverage_sources(base)}
            )
    return out[: settings()["max_summary_sentences"]]


def _days(p) -> int:
    return ndays(p["start"], p["end"])


def facts(rows, falls, cov, cur, base):
    return {
        "이번 구간": f"{cur['start']} ~ {cur['end']}",
        "기준 구간": f"{base['start']} ~ {base['end']}" if base else None,
        "이번 구간 기록일": cov,
        "낙상 날짜": falls,
        "표시된 유형": [
            {
                "유형": _ko(r["type"]),
                "표시": "새로 나타남" if r["mark"] == "new" else "증가",
                "기준%": pct(r["baseline_rate"]),
                "이번%": pct(r["current_rate"]),
                "기록일": r["recorded_days"],
                "발생일": r["occurrence_days"],
                **({"처음 기록된 날": r["_occ"][0]} if r["mark"] == "new" else {}),
            }
            for r in signals(rows)
        ],
    }


def check(sentences: list[str], fx: dict, rows, falls) -> list[str]:
    """검사 6가지. 떨어진 이유 목록 (비면 통과)."""
    s = settings()
    text = " ".join(sentences)
    why = []
    allowed = {int(n) for n in re.findall(r"\d+", json.dumps(fx, ensure_ascii=False))}
    if not {int(n) for n in re.findall(r"\d+", text)} <= allowed:
        why.append("사실에 없는 숫자")
    if any(w in text for w in s["forbidden_expressions"]):
        why.append("금지 표현")
    if any(w in text for w in s["cause_expressions"]):
        why.append("원인 해석")
    sig = signals(rows)
    if (
        not 1 <= len(sentences) <= s["max_summary_sentences"]
        or (falls and "낙상" not in text)
        or any(_ko(r["type"]) not in text for r in sig)
    ):
        why.append("누락·문장 수")
    for r in sig:
        mine = [x for x in sentences if _ko(r["type"]) in x]
        need = r["_occ"][0] if r["mark"] == "new" else f"{pct(r['current_rate'])}%"
        if not any(need in x for x in mine):
            why.append("표시 유형에 수치 없음")
        if (
            r["mark"] == "new"
            and any("증가" in x for x in mine)
            or r["mark"] == "increase"
            and any("처음" in x or "새로" in x for x in mine)
        ):
            why.append("증가·새로 나타남 뒤바뀜")
    if falls and not any(falls[0] in x for x in sentences if "낙상" in x):
        why.append("낙상 날짜 없음")
    return why


def split_lines(content: str) -> list[str]:
    """줄마다 앞의 목록 기호("- ", "1. ", "2) ")만 뗌. 날짜로 시작하는 문장("2026-08-22와 …")은 그대로 둠."""
    lines = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", x).strip() for x in content.splitlines()]
    return [x for x in lines if x]


async def llm(rows, falls, fall_row, cov, cur, base) -> list[dict] | None:
    """요약 모델로 쓰고 검사. 실패하면 None (문장 틀을 씀)."""
    s = settings()
    fx = facts(rows, falls, cov, cur, base)
    client = AsyncClient(host=ollama_host(), timeout=s["summary_timeout_sec"])
    for _ in range(1 + s["summary_retry"]):
        try:
            res = await client.chat(
                model=s["summary_model"],
                options={"temperature": 0},
                think=False,
                messages=[{"role": "user", "content": PROMPT.format(facts=json.dumps(fx, ensure_ascii=False))}],
            )
        except Exception:  # 연결·시간 초과·모델 없음 모두 문장 틀로
            return None
        lines = split_lines(res.message.content or "")
        if not check(lines, fx, rows, falls):
            by_type = {_ko(r["type"]): r for r in rows}
            out = []
            for line in lines:
                hit = [r for k, r in by_type.items() if k in line] or ([fall_row] if "낙상" in line else [])
                comp = any(r["mark"] == "increase" for r in hit)
                out.append(
                    {
                        "scope": "comparison" if comp else "current",
                        "types": [r["type"] for r in hit],
                        "text": line,
                        "evidence_dates": sorted(
                            {d for r in hit for d in (r["evidence_dates"] if comp else r["_cur_dates"])}
                        ),
                        "memo_ids": sorted({i for r in hit for i in (r["memo_ids"] if comp else r["_cur_mids"])}),
                    }
                )
            return out
    return None
