import json, sys, collections, statistics
from itda.extract import call
from itda.dates import resolve_date
import datetime as dt
model = sys.argv[1]; n = int(sys.argv[2])
rows = [json.loads(l) for l in open("data/synth_eval.jsonl")][:n]
REAL = [
 "아침에 일어나시더니 여기가 어디냐고 물으심. 밤에 두 번 깨셔서 거실을 왔다 갔다 하셨음.",
 "지난밤에 한숨도 안 주무시고 현관문을 계속 여시려고 함. 결국 새벽 다섯 시쯤 겨우 잠드심.",
 "이틀 전 목욕시키려는데 소리 지르며 밀치셨음. 오늘은 조용하셨다.",
 "점심때 밥을 몇 숟갈만 드시고 안 드신다고 하심. 약도 뱉어 내셨음.",
 "사흘 전에 화장실에서 미끄러져 넘어지셨는데 다친 데는 없음.",
 "엊그제 밤에 누가 창문 밖에 서 있다고 하셨음.",
 "오늘 오후에 지갑을 며느리가 가져갔다고 화내심.",
 "요즘 부쩍 우울해 보이시고 하루 종일 누워만 계심.",
 "오늘은 별일 없었음. 산책 잘 하심.",
 "어제 저녁 식사 후에 나보고 누구냐고 하셨어요ㅠㅠ 한참 설명드림.",
 "새벽 두 시쯤 깨셔서 옷 입고 나가시려고 함. 아침엔 기억 못 하심.",
 "밤마다 깨시는 것 같은데 확실하진 않음. 반 공기 드심.",
 "혼자 있으면 불안해하셔서 잠깐 장보러 가는 것도 못 함. 나도 너무 지친다.",
 "어머니가 오늘 아침 약을 안 드시겠다고 버티셨는데 점심 때 드셨음. 저녁에 딸 이름을 헷갈리심.",
 "아까 머리를 부딪히셨는데 괜찮다고 하심. 지갑이 없어졌다고 난리.",
]
def f1(g, p):
    gc = collections.Counter((e["type"], e["status"]) for e in g); pc = collections.Counter((e["type"], e["status"]) for e in p)
    h = sum((gc & pc).values()); return h, sum(pc.values()) - h, sum(gc.values()) - h
tp = fp = fn = 0; times = []; bad = 0; ev_miss = 0; ev_tot = 0; te = collections.Counter()
for r in rows:
    try:
        raw, t = call(model, r["memo"]); times.append(t); p = json.loads(raw)["events"]
    except Exception as ex:
        bad += 1; continue
    a, b, c = f1(r["gold"]["events"], p); tp += a; fp += b; fn += c
    for e in p:
        ev_tot += 1; ev_miss += e["evidence"] not in r["memo"]
pr = tp / (tp + fp or 1); rc = tp / (tp + fn or 1)
print(f"[{model}] synth {len(rows)}건 F1={2*pr*rc/(pr+rc or 1):.3f} P={pr:.3f} R={rc:.3f} JSON실패={bad} evidence원문없음={ev_miss}/{ev_tot}")
print(f"  지연 중앙 {statistics.median(times):.1f}s 최대 {max(times):.1f}s")
W = dt.date(2026, 9, 24); unk = 0; tot = 0
for m in REAL:
    raw, t = call(model, m); p = json.loads(raw)["events"]
    print(f"\n({t:.1f}s) {m}")
    for e in p:
        d, u = resolve_date(e["time_expr"], W); tot += 1; unk += u
        miss = "" if e["evidence"] in m else "  ⚠evidence 원문에 없음"
        print(f"   {e['type']:18s} {e['status']:7s} time={e['time_expr']!r:14s} → {'알수없음' if u else d.strftime('%m/%d')}  ev={e['evidence']!r}{miss}")
print(f"\n실제형 메모 사건 {tot}건 중 날짜 알수없음 {unk}건")
