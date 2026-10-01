"""synth_eval.jsonl의 메모를 Ollama 모델에 넣고 정답(gold)과 비교해 채점한다. 기준: 최종기획안 8-4 ①
실행: python3 ~/itda/eval/eval.py [--model 모델이름] [--shots 3] [--limit N]
  파인튜닝 전: --shots 3 (기본값, 학습 데이터 예시 3개를 앞에 붙임)
  파인튜닝 후: --shots 0
결과: 화면에 점수, ~/itda/eval/results/<모델>_shots<N>.jsonl 에 건별 답
"""
import argparse, json, os, platform, time, urllib.request
from collections import Counter
from pathlib import Path

REPO = Path.home() / "itda/ai"
p = argparse.ArgumentParser()
p.add_argument("--model", default="qwen3:4b-instruct-2507-q4_K_M")
p.add_argument("--data", default=str(REPO / "ml/data/synth_eval.jsonl"))
p.add_argument("--shots", type=int, default=3, help="앞에 붙일 학습 예시 수 (파인튜닝 후엔 0)")
p.add_argument("--limit", type=int, default=0, help="앞에서 N건만 (0 = 전부)")
p.add_argument("--cpu", action="store_true", help="GPU 없이 CPU만으로 실행 (처리 시간 측정용)")
args = p.parse_args()

TYPES = ["night_waking", "wandering_exit", "agitation", "irritability", "anxiety", "low_mood_apathy",
         "delusion", "hallucination", "reduced_intake", "medication_refusal", "confusion", "fall"]
SCHEMA = {"type": "object", "required": ["events"], "properties": {"events": {"type": "array", "items": {
    "type": "object", "required": ["type", "status", "time_expr", "count", "evidence"], "properties": {
        "type": {"type": "string", "enum": TYPES},
        "status": {"type": "string", "enum": ["present", "absent"]},
        "time_expr": {"type": ["string", "null"]},
        "count": {"type": "integer", "minimum": 1},
        "evidence": {"type": "string"}}}}}}  # 기획안 4-4 스키마

SYSTEM = (REPO / "config/system_prompt.txt").read_text(encoding="utf-8").strip()
# ponytail: 예시는 train 앞 N건 고정, 유형을 골고루 고르려면 여기서 선택
SHOTS = [m for l in open(REPO / "ml/data/train.jsonl", encoding="utf-8").readlines()[:args.shots]
         for m in json.loads(l)["messages"] if m["role"] != "system"]
DS = Path(args.data).stem
rows = [json.loads(l) for l in open(args.data, encoding="utf-8") if l.strip()]
# val.jsonl처럼 학습용 messages 형식이면 memo/gold 형식으로 바꿈
rows = [{"id": f"val-{i:04d}", "memo": r["messages"][1]["content"], "gold": json.loads(r["messages"][2]["content"])}
        if "messages" in r else r for i, r in enumerate(rows)]
if args.limit: rows = rows[:args.limit]

def ask(memo):
    body = {"model": args.model, "stream": False, "format": SCHEMA, "options": {"temperature": 0, **({"num_gpu": 0} if args.cpu else {})},
            "messages": [{"role": "system", "content": SYSTEM}, *SHOTS, {"role": "user", "content": memo}]}
    req = urllib.request.Request("http://localhost:11434/api/chat", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=300))["message"]["content"]

def ollama_get(path):
    return json.load(urllib.request.urlopen("http://localhost:11434" + path, timeout=30))

def find(models):  # "itda-qwen"과 "itda-qwen:latest"를 같은 모델로 봄
    return next((m for m in models if m["name"] in (args.model, args.model + ":latest")), {})

def cpu_name():
    try:
        return next(l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name"))
    except (OSError, StopIteration):
        return platform.processor() or "알 수 없음"

def by_key(events):  # 채점 단위: (유형, 있었음/없었음). 같은 키가 여러 번이면 첫 사건을 씀
    d = {}
    for e in events:
        if isinstance(e, dict): d.setdefault((e.get("type"), e.get("status")), e)
    return d

tp, fp, fn = Counter(), Counter(), Counter()
ok_json = exact = empty_n = empty_ok = time_n = time_ok = ev_n = ev_in = 0
secs = []
out = Path(__file__).parent / "results" / f"{args.model.replace(':', '_').replace('/', '_')}_shots{args.shots}{'_cpu' if args.cpu else ''}{'' if DS == 'synth_eval' else '_' + DS}.jsonl"
out.parent.mkdir(exist_ok=True)
ask(rows[0]["memo"])  # 첫 호출은 모델을 메모리에 올리는 시간이 섞이므로 측정 전에 한 번 돌려 둠
with open(out, "w", encoding="utf-8") as f:
    for i, r in enumerate(rows, 1):
        t0 = time.time(); raw = ask(r["memo"]); secs.append(time.time() - t0)
        try:
            events = json.loads(raw)["events"]; ok_json += 1
        except (ValueError, KeyError, TypeError):
            events = []
        pred, gold = by_key(events), by_key(r["gold"]["events"])
        exact += pred.keys() == gold.keys()
        if not gold:
            empty_n += 1; empty_ok += not pred
        for k in pred.keys() & gold.keys():
            tp[k[0]] += 1; time_n += 1; time_ok += pred[k].get("time_expr") == gold[k].get("time_expr")
        for k in pred.keys() - gold.keys(): fp[k[0]] += 1
        for k in gold.keys() - pred.keys(): fn[k[0]] += 1
        for e in events:
            if isinstance(e, dict): ev_n += 1; ev_in += bool(e.get("evidence")) and e["evidence"] in r["memo"]
        f.write(json.dumps({"id": r["id"], "memo": r["memo"], "gold": r["gold"], "answer": raw,
                            "correct": pred.keys() == gold.keys()}, ensure_ascii=False) + "\n")
        print(f"\r{i}/{len(rows)}", end="", flush=True)

def pct(a, b): return f"{a / b:.1%}" if b else "-"
def f1(t, p_, n): return 2 * t / (2 * t + p_ + n) if t + p_ + n else 0.0
T, P, N = sum(tp.values()), sum(fp.values()), sum(fn.values())
ps, tag = find(ollama_get("/api/ps")["models"]), find(ollama_get("/api/tags")["models"])
def GB(n): return f"{n / 1e9:.2f}GB" if n else "-"
KO = json.loads((REPO / "config/labels.json").read_text(encoding="utf-8"))["type"]
report = f"""
[{args.model}] 예시 {args.shots}개, {DS} 메모 {len(rows)}건
('사건' = 메모 속 증상 하나. 유형과 있었음/없었음이 둘 다 정답과 같으면 맞은 것으로 셈)

■ 핵심 점수
F1                  {f1(T, P, N):.3f}
  → 정밀도와 재현율을 합친 종합 점수(0~1, 1이 만점). 발표의 '파인튜닝 전 → 후' 비교 숫자
정밀도              {pct(T, T + P)}   (맞게 뽑음 {T} / 모델이 뽑은 전체 {T + P})
  → 모델이 '있다'고 뽑은 증상 중 진짜 맞은 비율. 낮으면 없는 증상을 지어냄
재현율              {pct(T, T + N)}   (맞게 뽑음 {T} / 정답 전체 {T + N})
  → 메모에 실제 있던 증상 중 모델이 찾아낸 비율. 낮으면 증상을 놓침

■ 형식·안정성
JSON 형식 통과율    {pct(ok_json, len(rows))}
  → 답이 약속한 JSON 모양으로 나온 비율. 깨지면 앱이 결과를 못 읽음 (성공 기준 100%)
메모 완전 정답률    {pct(exact, len(rows))}   ({exact}/{len(rows)})
  → 메모 하나에서 뽑은 증상 목록이 정답과 하나도 안 틀리고 똑같은 비율. 가장 엄격한 점수
잡담 메모 빈 결과   {pct(empty_ok, empty_n)}   ({empty_ok}/{empty_n})
  → 증상이 전혀 없는 메모에 '없음'이라고 답한 비율. 낮으면 평범한 일상도 증상으로 오해함

■ 세부 항목 (맞게 뽑은 증상 기준)
시간 표현 일치율    {pct(time_ok, time_n)}
  → '어젯밤', '그저께' 같은 시간 표현을 메모 그대로 옮긴 비율. 틀리면 발생 날짜가 틀어짐
근거 원문 포함률    {pct(ev_in, ev_n)}
  → 근거로 댄 문구가 메모에 실제로 있는 비율. 낮으면 근거를 지어냄

■ 크기·속도 (팀 모델 선정용)
처리 시간           평균 {sum(secs) / len(secs):.1f}초 / 최대 {max(secs):.1f}초 (메모 1건, {'CPU만 사용' if args.cpu else 'GPU 사용'})
  → 메모 하나를 정리하는 데 걸린 시간. 모델 로딩 시간은 뺐음 (성공 기준은 CPU만으로 30초 이내)
모델 파일 크기      {GB(tag.get('size'))}
  → 내려받고 설치하는 파일 크기. 작을수록 배포가 쉬움
실행 메모리         {GB(ps.get('size'))}
  → 모델이 돌아가는 동안 차지하는 메모리. 보호자 PC 메모리가 이보다 넉넉해야 함
측정 PC             {cpu_name()} ({os.cpu_count()}스레드)
  → 속도는 PC 성능에 따라 크게 달라지므로, 다른 사람 결과와 비교할 때 꼭 같이 볼 것

■ 증상 유형별
  F1 = 그 유형의 종합 점수 / 맞음 = 맞게 뽑음 / 헛뽑음 = 없는데 뽑음 / 놓침 = 있는데 못 뽑음
{'F1':>6}{'맞음':>6}{'헛뽑음':>7}{'놓침':>6}   유형
""" + "\n".join(f"{f1(tp[t], fp[t], fn[t]):>6.2f}{tp[t]:>6}{fp[t]:>7}{fn[t]:>6}   {KO[t]} ({t})"
                for t in TYPES)
print("\n" + report)
out.with_name(out.stem + "_report.txt").write_text(report.lstrip() + "\n", encoding="utf-8")
print(f"\n보고서 저장: {out.with_name(out.stem + '_report.txt')}")
