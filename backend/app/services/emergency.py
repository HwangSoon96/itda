"""응급 키워드: 글자 부분 일치. 오탐이 있어도 놓치는 것보다 낫다 (기획안 7-3)."""

from ..settings import settings


def check(text: str) -> dict:
    s = settings()
    matched = any(k in text for k in s["emergency_keywords"])
    return {"matched": matched, "message": s["emergency_message"] if matched else None}
