"""핵심 요약: 실제 로컬 모델이 코드 검사를 얼마나 통과하는지."""
import sys
import time

from itda.summarize import build_facts, call, check

rows = [dict(type="wandering_exit", mark="increase", baseline_rate=0.1, current_rate=13 / 34, current_days=13, first_date="2026-08-22"),
        dict(type="night_waking", mark="increase", baseline_rate=0.2, current_rate=15 / 34, current_days=15, first_date="2026-08-21"),
        dict(type="delusion", mark="new", baseline_rate=0.0, current_rate=3 / 34, current_days=3, first_date="2026-09-07")]
facts = build_facts(rows, ["2026-09-18"], (34, 38))
good = """낙상은 9월 18일에 1회 기록됨.
망상은 기준 구간에는 기록이 없었고 이번 구간 9월 7일에 처음 기록되어 총 3일 나타남.
배회·출입문 시도의 발생일 비율이 기준 구간 10%에서 이번 구간 38%로 증가 표시됨 (기록일 34일 중 13일).
야간 각성의 발생일 비율이 기준 구간 20%에서 이번 구간 44%로 증가 표시됨 (기록일 34일 중 15일)."""
print("사람이 쓴 정답 요약 →", check(good, facts)[1])
print("정답 + '초기에는' 한 문장 →", check(good + "\n이번 구간 초기에는 기록이 적었음.", facts)[1])
print("정답 + '줄어들었음' →", check(good.replace("나타남.", "나타났고 이후 줄어들었음."), facts)[1])
for model in sys.argv[1:]:
    res, times = [], []
    for i in range(3):
        t = time.time()
        out = call(model, facts)
        times.append(time.time() - t)
        res.append(check(out, facts)[1])
        if i == 0:
            print(f"\n[{model}] 첫 출력\n{out}")
    print(f"[{model}] 3회: {res}  시간 {[round(x, 1) for x in times]}s")
