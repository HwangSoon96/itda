"""목 서버 결과를 명세 v3의 '서버가 보낼 JSON'(영문 코드)으로 바꾸고 Pydantic으로 검사해 저장.

출력: /tmp/itda/wire_examples.json  → 프론트 디코더 검사(check_wire.local.test.ts)와 명세 예시에 씀.
"""
import json

from itda import schemas as S

TYPES = {"야간 각성": "night_waking", "배회·출입문 시도": "wandering_exit", "초조·공격": "agitation", "과민·짜증": "irritability",
         "불안": "anxiety", "우울·무기력": "low_mood_apathy", "망상": "delusion", "환각": "hallucination",
         "식사량 감소": "reduced_intake", "복약 거부": "medication_refusal", "사람·장소 혼동": "confusion", "낙상": "fall"}
ST = {"있었음": "present", "없었음": "absent"}
MEMO = {"확인 대기": "pending", "확인 완료": "confirmed", "정리 실패": "failed"}
VISIT = {"예정": "scheduled", "완료": "completed"}
CHANGE = {"시작": "start", "증량": "increase", "감량": "decrease", "중단": "stop"}
MARK = {"증가": "increase", "새로 나타남": "new", "비교 불가": "not_comparable", "기록 부족": "insufficient", None: None}
dump = json.load(open("/tmp/itda/mock_dump.json", encoding="utf-8"))


def ev(e):
    out = dict(type=TYPES[e["type"]], status=ST[e["status"]], time_expr=e["time_expr"], count=e["count"], evidence=e["evidence"])
    if "model_event_index" in e:
        out["model_event_index"] = e["model_event_index"]
    return out


def memo(m):
    return dict(memo_id=m["memo_id"], status=MEMO[m["status"]], emergency=m["emergency"], events=[ev(e) for e in m["events"]],
                text=m["text"], record_date=m["record_date"], error=m.get("error"), model_output=m.get("model_output"),
                failure_code=m.get("failure_code"))


def r4(x):
    return None if x is None else round(x, 4)


def row(r):
    keep = ["evidence_dates", "memo_ids", "occurrence_days", "recorded_days", "mentioned_days", "absent_days", "unmentioned_days",
            "baseline_recorded_days", "baseline_occurrence_days", "baseline_mentioned_days", "baseline_absent_days",
            "baseline_unmentioned_days"]
    return dict(type=TYPES[r["type"]], baseline_rate=r4(r["baseline_rate"]), current_rate=r4(r["current_rate"]),
                weekly_count=None if r["weekly_count"] is None else round(r["weekly_count"], 1), mark=MARK[r["mark"]],
                **{k: r[k] for k in keep})


def med(x):
    return dict(name=x["name"], change_type=CHANGE[x["change_type"]], date=x["date"])


def trends(t):
    return dict(type=TYPES[t["type"]], period=t["period"], baseline=t["baseline"], markers=t.get("markers", []),
                weeks=[dict(w, rate=r4(w["rate"])) for w in t["weeks"]], medications=[med(x) for x in t["medications"]])


def summary(s):
    return dict(patient_alias=s["patient_alias"], period=s["period"], baseline=s["baseline"], coverage=s["coverage"],
                baseline_coverage=s["baseline_coverage"], exclusions=s["exclusions"], summary_source=s["summary_source"],
                basis_note=s["basis_note"], trends=[trends(t) for t in s["trends"]], markers=s["markers"],
                rows=[row(r) for r in s["rows"]],
                sentences=[dict(scope=x["scope"], types=[TYPES[t] for t in x.get("types", [])], text=x["text"],
                                evidence_dates=x["evidence_dates"], memo_ids=x.get("memo_ids", [])) for x in s["sentences"]],
                medications=[med(x) for x in s["medications"]], falls=s["falls"], questions=s["questions"], disclaimer=s["disclaimer"])


case = dump["cases"]["2026-09-27|"]
out = {
    "memos": [memo(m) for m in dump["memos"]],
    "memo_pending": memo(next(m for m in dump["memos"] if m["status"] == "확인 대기")),
    "memo_failed": memo(next(m for m in dump["memos"] if m["status"] == "정리 실패")),
    "visits": [dict(id=v["id"], visit_date=v["visit_date"], status=VISIT[v["status"]]) for v in dump["visits"]],
    "medications": [dict(id=x["id"], name=x["name"], change_type=CHANGE[x["change_type"]], change_date=x["change_date"]) for x in dump["medications"]],
    "questions": [dict(q, created_at=q["created_at"] + "T21:10:00+09:00" if len(q["created_at"]) == 10 else q["created_at"]) for q in dump["questions"]],
    "summary": summary(case["summary"]),
    "trends": trends(case["trends"]["야간 각성"]),
    "health": dict(ok=True, ai_available=True, model_name="itda-a", allow_lan=False,
                   emergency_keywords=["의식이 없", "경련", "없어졌"], emergency_message="생명이 위험하거나 응급 상황이면 즉시 119에 …",
                   ai_notice="AI가 정리한 내용이에요. 틀린 부분은 고쳐 주세요.", disclaimer="보호자 일지 자동 정리본이며 …", temporary_model=False),
    "patient": {"alias": "이OO (가상 인물)"},
    "revisions": [dict(id=31, created_at="2026-09-24T08:15:02+09:00", kind="최초 확인", before_events=[],
                       after_events=[ev(e) for e in next(m for m in dump["memos"] if m["events"])["events"]])],
    "error": dict(detail="메모를 찾지 못했어요.", code="memo_not_found"),
}
checks = [("memos", S.MemoResult, True), ("memo_pending", S.MemoResult, False), ("memo_failed", S.MemoResult, False),
          ("visits", S.Visit, True), ("medications", S.Medication, True), ("questions", S.Question, True),
          ("summary", S.Summary, False), ("trends", S.Trends, False), ("health", S.Health, False), ("patient", S.Patient, False),
          ("revisions", S.MemoRevision, True), ("error", S.ErrorBody, False)]
n = 0
for key, model, many in checks:
    for item in (out[key] if many else [out[key]]):
        model.model_validate(item); n += 1
json.dump(out, open("/tmp/itda/wire_examples.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("Pydantic 검사 통과:", n, "개 객체")

# ── 명세 문서에 싣는 예시 (기록 흐름 한 줄기). 모두 Pydantic 검사 + 프론트 디코더 검사를 거침 ──
TEXT = "새벽 3시쯤 깨서 현관문 열려고 하심. 저녁은 반 공기밖에 안 드심. 낮에는 혼자 있으면 불안해하심."
EV = [dict(type="night_waking", status="present", time_expr="새벽 3시쯤", count=1, evidence="새벽 3시쯤 깨서", model_event_index=0),
      dict(type="wandering_exit", status="present", time_expr="새벽 3시쯤", count=1, evidence="현관문 열려고 하심", model_event_index=1),
      dict(type="reduced_intake", status="present", time_expr=None, count=1, evidence="저녁은 반 공기밖에 안 드심", model_event_index=2)]
MODEL_OUT = json.dumps({"events": [{k: v for k, v in e.items() if k != "model_event_index"} for e in EV]}, ensure_ascii=False)
base = dict(memo_id=110, emergency=dict(matched=False, message=None), text=TEXT, record_date="2026-09-23")
edited = [dict(EV[0]), dict(EV[1], count=2), dict(EV[2])]
doc = {
    "memo_create": dict(text=TEXT, record_date="2026-09-23", request_id="3f2b9c1e-6d0a-4f5b-9a7e-2c8d1e4b7a10"),
    "memo_pending": dict(base, status="pending", events=EV, error=None, model_output=MODEL_OUT, failure_code=None),
    "memo_failed": dict(base, status="failed", events=[], error="AI 정리에 시간이 오래 걸려 멈췄어요.", model_output=None, failure_code="timeout"),
    "memo_update": dict(text=TEXT + " 오후엔 기분 좋으셨음.", request_id="8c41d0aa-0b7e-4f0e-8f2c-5f1a2b3c4d5e"),
    "confirm_request": dict(events=edited, manual=False),
    "manual_confirm": dict(events=[dict(EV[1], model_event_index=None)], manual=True),
    "memo_confirmed": dict(base, status="confirmed", events=edited, error=None, model_output=MODEL_OUT, failure_code=None),
    "event_create": dict(memo_id=110, type="anxiety", status="present", time_expr="낮에는", count=1, evidence="혼자 있으면 불안해하심", model_event_index=None),
    "visit_create": dict(visit_date="2026-08-20", status="completed"),
    "visit_update": dict(status="completed"),
    "medication_create": dict(name="예시 약 A (가상)", change_type="start", change_date="2026-08-25"),
    "question_create": dict(text="밤에 깬 시간과 횟수 외에 무엇을 더 기록할까요?"),
    "question": dict(id=7, text="밤에 깬 시간과 횟수 외에 무엇을 더 기록할까요?", created_at="2026-09-21T21:10:00+09:00", period_start=None, period_end=None),
    "patient_put": dict(alias="이OO"),
    "errors": [dict(detail="메모를 찾지 못했어요.", code="memo_not_found"),
               dict(detail="직접 정리한 내용을 확인하거나 메모 정리를 다시 시도해 주세요.", code="memo_failed")],
}
for key, model in [("memo_create", S.MemoCreate), ("memo_pending", S.MemoResult), ("memo_failed", S.MemoResult),
                   ("memo_update", S.MemoUpdate), ("confirm_request", S.ConfirmRequest), ("manual_confirm", S.ConfirmRequest),
                   ("memo_confirmed", S.MemoResult), ("event_create", S.EventCreate), ("visit_create", S.VisitCreate),
                   ("visit_update", S.VisitUpdate), ("medication_create", S.MedicationCreate), ("question_create", S.QuestionCreate),
                   ("question", S.Question), ("patient_put", S.Patient)]:
    model.model_validate(doc[key])
for e in doc["errors"]:
    S.ErrorBody.model_validate(e)
for m in (doc["memo_pending"], doc["memo_confirmed"], dict(doc["memo_confirmed"], events=[doc["event_create"]])):   # 서버 규칙: 근거·시간 표현은 원문 안에
    assert all(e["evidence"] in m["text"] and (e["time_expr"] is None or e["time_expr"] in m["text"]) for e in m["events"])
out["doc"] = doc
json.dump(out, open("/tmp/itda/wire_examples.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("문서 예시 Pydantic 검사 통과:", len(doc), "개")
