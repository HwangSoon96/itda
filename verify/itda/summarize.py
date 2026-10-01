"""핵심 요약: 베이스 모델 + 코드 검사 (기획안 4-8, 가이드 3-6)."""
import json
import re
import urllib.request

FORBIDDEN = ["치매가 진행", "섬망", "악화되었습니다", "경증", "중등도", "중증", "초기", "중기", "말기", "약 때문에",
             "로 인해 나빠짐", "약을 늘리", "줄이", "끊으세요", "복용을 중단", "정상", "문제없음", "괜찮습니다", "이상 없음"]
CAUSE = ["때문", "로 인해", "탓", "영향으로", "덕분", "원인"]
KO = {"wandering_exit": "배회·출입문 시도", "night_waking": "야간 각성", "delusion": "망상", "fall": "낙상"}

PROMPT = """너는 치매 환자 보호자의 관찰 기록을 의사에게 전달하는 요약 문장을 쓴다.
아래 사실(JSON)만 사용해서 한국어로 3~5문장을 쓴다.
규칙:
- 사실에 없는 숫자, 날짜, 비율을 새로 만들지 않는다. 숫자는 사실에 적힌 그대로 쓴다.
- 원인을 해석하지 않는다(때문, 로 인해, 영향 같은 말 금지). 진단·단계·약 조언·안심 표현을 쓰지 않는다.
- 낙상이 있으면 가장 먼저 쓰고, 표시가 붙은 유형은 모두 쓴다.
- 문장은 "~됨.", "~음." 으로 끝낸다. 번호나 기호 없이 한 줄에 한 문장.
- 아래 모양을 따른다(값만 바꿈):
  낙상은 [날짜]에 [횟수]회 기록됨.
  [유형]은 기준 구간에는 기록이 없었고 이번 구간 [처음 기록된 날]에 처음 기록되어 총 [발생일 수]일 나타남.
  [유형]의 발생일 비율이 기준 구간 [기준%]%에서 이번 구간 [이번%]%로 증가 표시됨 (기록일 [기록일 수]일 중 [발생일 수]일).
사실:
{facts}"""


def pct(x):
    return int(x * 100 + 0.5)


def md(d):
    return f"{int(d[5:7])}월 {int(d[8:10])}일"


def build_facts(rows, falls, coverage):
    items = []
    for r in rows:
        if r["mark"] in ("increase", "new"):
            f = {"유형": KO[r["type"]], "표시": "증가" if r["mark"] == "increase" else "새로 나타남",
                 "기준 구간 비율(%)": pct(r["baseline_rate"]), "이번 구간 비율(%)": pct(r["current_rate"]),
                 "이번 구간 발생일 수": r["current_days"], "이번 구간 기록일 수": coverage[0]}
            if r["mark"] == "new":
                f["이번 구간 처음 기록된 날"] = md(r["first_date"])
            items.append(f)
    return {"낙상": [{"날짜": md(d), "횟수": 1} for d in falls], "표시 붙은 유형": items,
            "기록 커버리지": {"기록일 수": coverage[0], "전체 일수": coverage[1]}}


def nums(s):
    return set(re.findall(r"\d+", s))


def check(text, facts, max_sent=5):
    """통과하면 문장 목록, 떨어지면 (None, 이유)."""
    sents = [s.strip(" -•·0123456789.") for s in re.split(r"(?<=[.。])\s+|\n+", text.strip()) if s.strip()]
    sents = [s for s in sents if s]
    fs = json.dumps(facts, ensure_ascii=False)
    extra = nums(text) - nums(fs)
    if extra:
        return None, f"사실에 없는 숫자 {sorted(extra)}"
    bad = [w for w in FORBIDDEN if w in text]
    if bad:
        return None, f"금지 표현 {bad}"
    cause = [w for w in CAUSE if w in text]
    if cause:
        return None, f"원인 해석 {cause}"
    norm = text.replace(" 및 ", "·")
    need = [i["유형"] for i in facts["표시 붙은 유형"]] + (["낙상"] if facts["낙상"] else [])
    miss = [n for n in need if n not in norm]
    if miss:
        return None, f"누락 {miss}"
    for i in facts["표시 붙은 유형"]:   # 내용 검사: 표시 유형 문장에 이번 구간 %가 있어야 함
        sent = next((x for x in sents if i["유형"] in x.replace(" 및 ", "·")), "")
        key = i.get("이번 구간 처음 기록된 날") or f'{i["이번 구간 비율(%)"]}%'
        if key not in sent.replace(" %", "%"):
            return None, f"숫자 없는 문장 [{i['유형']}]"
    kinds = {i["유형"]: i["표시"] for i in facts["표시 붙은 유형"]}
    for x in sents:   # 의미 검사: 유형마다 맞는 표시 문장인지
        for name, kind in kinds.items():
            if name in x.replace(" 및 ", "·"):
                if kind == "증가" and ("처음 기록" in x or "기록이 없었" in x):
                    return None, f"뒤바뀐 사실 [{name}은 증가인데 새로 나타남처럼 씀]"
                if kind == "새로 나타남" and "증가" in x:
                    return None, f"뒤바뀐 사실 [{name}은 새로 나타남인데 증가처럼 씀]"
    for f in facts["낙상"]:
        if f["날짜"] not in text:
            return None, "낙상 날짜 없음"
    if not 1 <= len(sents) <= max_sent:
        return None, f"문장 수 {len(sents)}"
    return sents, "통과"


def call(model, facts, timeout=180):
    body = {"model": model, "stream": False, "think": False, "options": {"temperature": 0},
            "messages": [{"role": "user", "content": PROMPT.format(facts=json.dumps(facts, ensure_ascii=False, indent=1))}]}
    req = urllib.request.Request("http://127.0.0.1:11434/api/chat", json.dumps(body).encode(), {"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=timeout))["message"]["content"]
