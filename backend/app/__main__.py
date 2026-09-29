"""uv run python -m app : settings.yaml의 allow_lan에 따라 주소를 골라 서버를 켬 (기획안 7-4)."""

import uvicorn

from .settings import settings

if __name__ == "__main__":
    host = "0.0.0.0" if settings()["allow_lan"] else "127.0.0.1"
    uvicorn.run("app.main:app", host=host, port=8000)
