"""오류 응답: {"detail": "보여 줄 문장", "code": "코드"} (명세 F19)."""

from datetime import datetime
from typing import Annotated

from fastapi import Path, Request
from fastapi.responses import JSONResponse

# 경로의 id: SQLite INTEGER 범위 밖이면 DB까지 가지 않고 422 (그대로 두면 OverflowError로 500)
Id = Annotated[int, Path(ge=1, le=2**63 - 1)]


class ApiError(Exception):
    def __init__(self, status: int, code: str, detail: str):
        self.status, self.code, self.detail = status, code, detail


def not_found(what: str, code: str) -> ApiError:
    return ApiError(404, code, f"{what}을 찾지 못했어요.")


def invalid(detail: str, code: str = "invalid_input") -> ApiError:
    return ApiError(422, code, detail)


async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"detail": exc.detail, "code": exc.code})


def now_iso() -> str:
    """로컬 시각 + 시간대. 프론트는 앞 10자리로 날짜를 판단함 (명세 R03)."""
    return datetime.now().astimezone().isoformat(timespec="seconds")
