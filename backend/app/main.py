"""앱 시작: 라우터 등록, /api 접두어 처리, 프론트 정적 파일 제공."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import configure, init_db
from .errors import ApiError, api_error_handler
from .routers import health, memos, schedule, summary
from .settings import STATIC


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    memos.recover_interrupted()
    yield


DESCRIPTION = """보호자 메모 저장·AI 정리·요약지 계산 API. 요청·응답 모양과 규칙은 팀 **API 명세서 v3**를 따른다.

- 값은 영문 코드로 주고받는다 (`night_waking`, `completed` …). 날짜는 `"2026-09-23"`.
- 오류: `{"detail": "보여 줄 문장", "code": "memo_not_found"}`. 입력 형식 오류(422)는 FastAPI 기본.
- AI가 실패해도 200: 메모는 `status: "failed"` + `failure_code`, 요약은 `summary_source: "template"`.
- 경로 앞에 `/api`가 붙어도 같은 API로 처리한다.
"""
TAGS = [
    {"name": "공통", "description": "서버·모델 상태와 화면 고정 문구"},
    {"name": "기록", "description": "메모 저장·AI 정리·확인·수정·삭제. AI 정리는 수십 초~수 분 걸릴 수 있음"},
    {"name": "일정", "description": "진료일(받은 진료·다음 예약)·약 변경·질문"},
    {"name": "요약지 · 경과", "description": "요약지·주간 추이 계산(저장하지 않고 매번 계산), 환자 가명"},
]


class StripApiPrefix:
    """/api/memos → /memos. 개발 때는 vite 프록시가 /api를 떼지만, 빌드 결과를 이 서버가 줄 때는
    브라우저가 /api/memos를 그대로 부르므로 여기서 뗀다 (명세 F18)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope["path"]
            if path == "/api" or path.startswith("/api/"):
                scope = dict(scope, path=path[4:] or "/", raw_path=None)
        await self.app(scope, receive, send)


def create_app() -> FastAPI:
    configure()
    app = FastAPI(
        title="잇다 API",
        version="0.2.0",
        description=DESCRIPTION,
        openapi_tags=TAGS,
        lifespan=lifespan,
    )
    app.add_exception_handler(ApiError, api_error_handler)
    for r in (health.router, memos.router, schedule.router, summary.router):
        app.include_router(r)
    if (STATIC / "index.html").exists():  # itda-frontend 빌드 결과. API 경로를 가리지 않게 마지막에 등록
        app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        def index():
            return FileResponse(STATIC / "index.html")

    app.add_middleware(StripApiPrefix)
    return app


app = create_app()
