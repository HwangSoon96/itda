"""정리 모델 호출과 결과 검사. 모델은 settings.yaml의 model_name (모델이 정해지면 그 값만 바꿈).

결과는 (사건 목록, None) 또는 (None, (failure_code, 보여 줄 문장)).
사건은 근거가 원문에 나오는 순서로 정렬해 돌려준다. 이 순서가 model_event_index의 기준이다.
"""

import json

import httpx
from ollama import AsyncClient, ResponseError
from pydantic import ValidationError

from ..schemas import Event
from ..settings import event_schema, ollama_host, settings, system_prompt

MESSAGES = {
    "connection_error": "이 PC의 AI 정리 프로그램에 연결하지 못했어요.",
    "model_not_found": "이 PC에 AI 정리 모델이 준비되지 않았어요.",
    "timeout": "AI 정리에 시간이 오래 걸려 멈췄어요.",
    "invalid_format": "AI가 읽을 수 있는 형식으로 답하지 못했어요.",
    "evidence_mismatch": "AI가 메모에 없는 내용을 넣어 정리를 마치지 못했어요.",
    "time_mismatch": "AI가 메모에 없는 시간 표현을 넣어 정리를 마치지 못했어요.",
    "interrupted": "프로그램이 중단되어 정리를 마치지 못했어요.",
    "unknown_error": "실패 원인을 확인할 수 없어요.",
}
Failure = tuple[str, str]


def failure(code: str) -> Failure:
    return code, MESSAGES[code]


def parse(text: str, raw: str) -> tuple[list[dict] | None, Failure | None]:
    """모델 답(JSON 문자열)을 검사. 모델 없이도 시험할 수 있게 분리."""
    try:
        items = json.loads(raw)["events"]
        events = [
            Event.model_validate({**e, "model_event_index": None}).model_dump(exclude={"model_event_index"})
            for e in items
        ]
    except (json.JSONDecodeError, KeyError, TypeError, ValidationError):
        return None, failure("invalid_format")
    if any(e["evidence"] not in text for e in events):
        return None, failure("evidence_mismatch")
    if any(e["time_expr"] is not None and e["time_expr"] not in text for e in events):
        return None, failure("time_mismatch")
    events.sort(key=lambda e: text.index(e["evidence"]))
    return events, None


async def extract(text: str) -> tuple[list[dict] | None, Failure | None]:
    """비동기: 모델이 답하는 동안 서버는 다른 요청을 처리한다."""
    s = settings()
    client = AsyncClient(host=ollama_host(), timeout=s["ollama_timeout_sec"])
    last: Failure = failure("unknown_error")
    for _ in range(1 + s["ollama_retry"]):
        try:
            res = await client.chat(
                model=s["model_name"],
                messages=[{"role": "system", "content": system_prompt()}, {"role": "user", "content": text}],
                format=event_schema(),
                options={"temperature": 0},
                think=False,
            )
        except ResponseError as e:
            if e.status_code == 404:
                return None, failure("model_not_found")
            last = failure("unknown_error")
            continue
        except (httpx.ConnectError, ConnectionError):
            return None, failure("connection_error")
        except (httpx.TimeoutException, TimeoutError):
            last = failure("timeout")
            continue
        events, fail = parse(text, res.message.content or "")
        if events is not None:
            return events, None
        last = fail
    return None, last
