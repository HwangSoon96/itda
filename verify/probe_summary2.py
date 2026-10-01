import sys, time
from itda.summarize import build_facts, call, check
cases = {
 "데모(표시 4개)": ([dict(type="wandering_exit", mark="increase", baseline_rate=0.1, current_rate=13/34, current_days=13, first_date="2026-08-22"),
            dict(type="night_waking", mark="increase", baseline_rate=0.2, current_rate=15/34, current_days=15, first_date="2026-08-21"),
            dict(type="delusion", mark="new", baseline_rate=0.0, current_rate=3/34, current_days=3, first_date="2026-09-07")], ["2026-09-18"], (34, 38)),
 "표시 1개·낙상 없음": ([dict(type="night_waking", mark="increase", baseline_rate=0.15, current_rate=9/21, current_days=9, first_date="2026-09-03")], [], (21, 30)),
 "낙상만 2회": ([], ["2026-09-05", "2026-09-19"], (25, 30)),
}
for model in sys.argv[1:]:
    for name, (rows, falls, cov) in cases.items():
        facts = build_facts(rows, falls, cov); res = []
        for i in range(3):
            out = call(model, facts); ok = check(out, facts)[1]; res.append(ok)
            if i == 0 and name.startswith("데모"): print(f"[{model}] {name}\n{out}")
        print(f"  [{model}] {name}: {res}")
