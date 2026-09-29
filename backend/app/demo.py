"""데모 기록을 DB에 넣는 명령 (명세 F17). 기존 기록이 있는 DB에는 넣지 않는다.

  ITDA_DB=demo.db uv run python -m app.demo load     # demo.db를 새로 만들고 데모 기록을 넣음
  ITDA_DB=demo.db uv run python -m app               # 발표 때 이 DB로 서버 실행

데모 기록은 itda-frontend 목 서버와 같은 파일(demo/)이라 화면 숫자가 목 서버와 같다.
파일의 한글 값은 영문 코드로 바꿔 넣는다.
"""

import datetime as dt
import json
import sys

from sqlalchemy import func, select

from .db import Event, Medication, Memo, Patient, Question, SessionLocal, Visit, configure, init_db
from .errors import now_iso
from .settings import ROOT, db_path, labels

DEMO = ROOT / "demo"


def _codes(key: str) -> dict[str, str]:
    return {ko: code for code, ko in labels()[key].items()}


def load() -> int:
    if SessionLocal.kw.get("bind") is None:
        configure()
    init_db()
    types, status, change = _codes("type"), _codes("status"), _codes("change_type")
    memo_status = _codes("memo_status")
    ctx = json.loads((DEMO / "demo_context.json").read_text(encoding="utf-8"))
    memos = json.loads((DEMO / "demo_memos.json").read_text(encoding="utf-8"))
    events = json.loads((DEMO / "demo_events.json").read_text(encoding="utf-8"))
    now = now_iso()

    def ev(e):
        return {
            "type": types[e["type"]],
            "status": status[e["status"]],
            "time_expr": e["time_expr"],
            "count": e["count"],
            "evidence": e["evidence"],
        }

    with SessionLocal() as s:
        if s.scalar(select(func.count()).select_from(Memo)):
            sys.exit(f"{db_path()}에 이미 기록이 있어요. 데모는 빈 DB에만 넣어요 (ITDA_DB=demo.db).")
        s.add(Patient(id=1, alias=ctx["patient_alias"]))
        for v in ctx["visits"]:
            s.add(
                Visit(visit_date=_date(v["visit_date"]), status={"완료": "completed", "예정": "scheduled"}[v["status"]])
            )
        for m in ctx["medications"]:
            s.add(Medication(name=m["name"], change_type=change[m["change_type"]], change_date=_date(m["change_date"])))
        for q in ctx["questions"]:
            s.add(Question(text=q["text"], created_at=f"{q['created_at']}T21:00:00+09:00"))
        for m in memos:
            st = memo_status[m["status"]]
            mine = [ev(e) for e in events if e["memo_id"] == m["id"]]
            model = mine if st == "confirmed" else [ev(e) for e in m.get("model_events", [])]
            row = Memo(
                id=m["id"],
                record_date=_date(m["record_date"]),
                text=m["text"],
                status=st,
                model_output=json.dumps({"events": model}, ensure_ascii=False) if st != "failed" else None,
                error=m.get("error"),
                failure_code="unknown_error" if st == "failed" else None,
                created_at=now,
                updated_at=now,
            )
            if st == "confirmed":
                row.events = [Event(ord=i, model_event_index=i, **e) for i, e in enumerate(mine)]
            s.add(row)
        s.commit()
        return len(memos)


def _date(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


if __name__ == "__main__":
    if sys.argv[1:] != ["load"]:
        sys.exit(__doc__)
    as_of = json.loads((DEMO / "demo_context.json").read_text(encoding="utf-8"))["as_of"]
    print(f"{db_path()}: 데모 메모 {load()}개를 넣었어요. 기준일 {as_of}")
