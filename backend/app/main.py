"""앱 시작: 라우터 등록, /api 접두어 처리, 프론트 정적 파일 제공."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import init_db
from .routers import health, memos, schedule, summary
from .settings import STATIC


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


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
    app = FastAPI(title="itda", lifespan=lifespan)
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
