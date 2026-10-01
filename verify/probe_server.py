"""서버 구조 검증: ① async 핸들러가 모델 호출 동안 서버 전체를 멈추는지 ② 화면 경로 새로고침(SPA) 동작."""
import os
import tempfile
import threading
import time

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def slow_model_call():
    time.sleep(3)  # ollama.Client().chat() 같은 동기 호출 흉내


def make_app(async_handler: bool, spa_fix: bool, static_dir: str):
    app = FastAPI()
    if async_handler:
        @app.post("/memos")
        async def memos():
            slow_model_call()
            return {"ok": 1}
    else:
        @app.post("/memos")
        def memos():
            slow_model_call()
            return {"ok": 1}

    @app.get("/health")
    def health():
        return {"ok": 1}

    @app.get("/summary")
    def summary():
        return {"rows": []}

    if spa_fix:
        @app.exception_handler(404)
        async def spa(request: Request, exc):
            if request.method == "GET" and "text/html" in request.headers.get("accept", ""):
                return FileResponse(os.path.join(static_dir, "index.html"))
            return __import__("fastapi").responses.JSONResponse({"detail": "not_found"}, 404)
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    return app


def serve(app, port):
    cfg = uvicorn.Config(app, port=port, log_level="error")
    s = uvicorn.Server(cfg)
    threading.Thread(target=s.run, daemon=True).start()
    time.sleep(1)
    return s


d = tempfile.mkdtemp()
open(os.path.join(d, "index.html"), "w").write("<html>APP</html>")
HTML = {"accept": "text/html"}

for port, is_async in ((8701, True), (8702, False)):
    srv = serve(make_app(is_async, False, d), port)
    t = threading.Thread(target=lambda: httpx.post(f"http://127.0.0.1:{port}/memos", timeout=30)); t.start()
    time.sleep(0.3)
    t0 = time.time(); httpx.get(f"http://127.0.0.1:{port}/health"); dt = time.time() - t0
    t.join(); srv.should_exit = True
    print(f"{'async def' if is_async else 'def      '} 핸들러: 모델 호출 중 /health 응답까지 {dt:.2f}s")

for port, fix in ((8703, False), (8704, True)):
    srv = serve(make_app(False, fix, d), port)
    b = f"http://127.0.0.1:{port}"
    r1 = httpx.get(b + "/record", headers=HTML); r2 = httpx.get(b + "/summary", headers=HTML); r3 = httpx.get(b + "/summary")
    print(f"404처리기 {'있음' if fix else '없음'}: 새로고침 /record → {r1.status_code} {r1.text[:20]!r} | 새로고침 /summary → {r2.text[:20]!r} | fetch /summary → {r3.text[:20]!r}")
    srv.should_exit = True
