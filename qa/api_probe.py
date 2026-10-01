"""켜 둔 서버(8000)에 보안·견고성·부하 시험. 데이터는 만들고 바로 지움.

  uv run --with httpx python qa/api_probe.py        # 결과: qa/out/api.json
"""

import asyncio
import json
import statistics
import time
from pathlib import Path

import httpx

API = "http://127.0.0.1:8000"
OUT = Path(__file__).parent / "out"
res: list[dict] = []


def check(name, ok, note=""):
    res.append({"case": name, "ok": bool(ok), "note": str(note)[:300]})


async def main():
    async with httpx.AsyncClient(base_url=API, timeout=120) as c:
        # ── 보안 ──
        r = await c.get("/memos", headers={"Origin": "http://evil.example"})
        check("CORS: 다른 출처에 허용 헤더 안 줌", "access-control-allow-origin" not in r.headers, dict(r.headers))
        r = await c.options("/memos", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "DELETE"})
        check("CORS 사전 요청 거절", "access-control-allow-origin" not in r.headers, r.status_code)
        for p in ("/../../etc/passwd", "/static/../app/settings.py", "/%2e%2e/%2e%2e/etc/passwd", "/assets/..%2f..%2fitda.db"):
            r = await c.get(p)
            check(f"경로 탈출 막힘 {p}", r.status_code in (404, 400, 422) and "root:" not in r.text and "SQLite" not in r.text,
                  r.status_code)
        r = await c.get("/memos", params={"from": "2026-01-01' OR '1'='1"})
        check("SQL 주입: 날짜 파라미터 422", r.status_code == 422, r.status_code)
        r = await c.post("/memos", json={"text": "x'); DROP TABLE memos;--", "record_date": "2026-09-01"})
        mid = r.json().get("memo_id")
        still = (await c.get("/memos")).status_code == 200
        check("SQL 주입: 메모 원문은 글자로 저장", r.status_code == 200 and still, r.status_code)
        if mid:
            await c.delete(f"/memos/{mid}")
        r = await c.post("/memos", content=b"{bad json", headers={"content-type": "application/json"})
        check("깨진 JSON → 422 (500 아님)", r.status_code == 422, r.status_code)
        r = await c.post("/memos", content=json.dumps({"text": "가" * 5_000_000, "record_date": "2026-09-01"}),
                         headers={"content-type": "application/json"})
        check("5M자 본문 → 422, 서버 생존", r.status_code == 422 and (await c.get("/health")).status_code == 200,
              r.status_code)
        r = await c.post("/memos", json={"text": "a", "record_date": "2026-09-01", "status": "confirmed"})
        check("모르는 필드(status 위조) → 422", r.status_code == 422, r.status_code)
        r = await c.post("/memos/1/confirm", json={"events": [{"type": "fall", "status": "present", "time_expr": None,
                                                               "count": 2**63, "evidence": "a"}]})
        check("거대한 count → 422/404 (500 아님)", r.status_code in (404, 422), r.status_code)
        r = await c.get("/memos/99999999999999999999/revisions")
        check("범위 밖 id → 4xx", 400 <= r.status_code < 500, r.status_code)
        r = await c.get("/docs")
        check("Swagger 문서 공개 여부(LAN 허용 시 노출)", True, f"/docs {r.status_code}")
        r = await c.get("/health")
        hdr = {k: r.headers.get(k) for k in ("x-content-type-options", "x-frame-options", "content-security-policy")}
        check("보안 헤더(참고)", True, hdr)

        # ── 부하 ──
        async def timed(coro):
            t = time.perf_counter()
            r = await coro
            return r.status_code, time.perf_counter() - t

        for path, n in (("/memos", 200), ("/summary/period", 200), ("/summary?ai=false", 100),
                        ("/trends?type=night_waking", 100)):
            t0 = time.perf_counter()
            out = await asyncio.gather(*(timed(c.get(path)) for _ in range(n)))
            wall = time.perf_counter() - t0
            lat = sorted(x[1] for x in out)
            bad = sum(s != 200 for s, _ in out)
            check(f"부하 GET {path} ×{n} 동시", bad == 0,
                  f"실패 {bad}, {n / wall:.0f} req/s, p50 {statistics.median(lat) * 1000:.0f}ms, "
                  f"p95 {lat[int(n * .95) - 1] * 1000:.0f}ms")

        # 동시 저장(모델 호출) 20건 + 그동안 읽기 응답성
        t0 = time.perf_counter()
        writes = [c.post("/memos", json={"text": f"PROBE{i} 어젯밤 깨서 현관문 열려고 하심", "record_date": "2026-09-01"})
                  for i in range(20)]
        reads = [timed(c.get("/health")) for _ in range(10)]
        outs = await asyncio.gather(*writes, *reads)
        w, rd = outs[:20], outs[20:]
        ids = [r.json()["memo_id"] for r in w if r.status_code == 200]
        st = [r.json()["status"] for r in w if r.status_code == 200]
        check("동시 저장 20건 (실제 모델)", len(ids) == 20, f"{time.perf_counter() - t0:.1f}s, 상태 {dict((s, st.count(s)) for s in set(st))}")
        check("저장 몰리는 동안 /health 응답", max(x[1] for x in rd) < 1.0, f"최대 {max(x[1] for x in rd) * 1000:.0f}ms")
        for i in ids:
            await c.delete(f"/memos/{i}")
    OUT.mkdir(exist_ok=True)
    (OUT / "api.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in res:
        print(("✅ " if r["ok"] else "❌ ") + r["case"] + " — " + r["note"][:150])


asyncio.run(main())
