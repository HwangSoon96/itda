"""잇다 웹 E2E: 실제 프론트(5173) + 실제 백엔드(8000) + 실제 모델을 브라우저로 조작.
실패 상황(서버 500·네트워크 끊김·AI 실패)만 응답을 가로채 만든다.

  uv run --with playwright python qa/e2e.py            # 결과: qa/out/e2e.json, 실패 스크린샷 qa/out/*.png
"""

import json
import re
import time
import traceback
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

URL, API = __import__("os").environ.get("E2E_URL", "http://127.0.0.1:5173/"), "http://127.0.0.1:8000"
OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)
AXE = "https://cdn.jsdelivr.net/npm/axe-core@4.10.3/axe.min.js"
results: list[dict] = []
TAG = f"E2E{int(time.time()) % 100000}"


def api(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, headers={"content-type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or "null")


class Watch:
    """콘솔 오류·페이지 예외·5xx 응답을 모음."""

    def __init__(self, page: Page):
        self.bad: list[str] = []
        self.allow_5xx = False
        page.on("pageerror", lambda e: self.bad.append(f"pageerror {e}"[:200]))
        page.on("console", lambda m: m.type == "error" and not self.allow_5xx and self.bad.append(f"console {m.text}"[:200]))
        page.on("response", lambda r: r.status >= 500 and not self.allow_5xx and self.bad.append(f"{r.status} {r.url}"))

    def take(self):
        out, self.bad = self.bad, []
        return out


def case(name):
    def deco(fn):
        def run(page, watch):
            t = time.perf_counter()
            try:
                note = fn(page) or ""
                errs = watch.take()
                ok = not errs
                results.append({"case": name, "ok": ok, "sec": round(time.perf_counter() - t, 1),
                                "note": note, **({"errors": errs} if errs else {})})
            except Exception as e:  # noqa: BLE001
                shot = OUT / f"fail_{len(results):02d}.png"
                page.screenshot(path=str(shot), full_page=True)
                results.append({"case": name, "ok": False, "sec": round(time.perf_counter() - t, 1),
                                "error": f"{type(e).__name__}: {e}"[:600], "shot": shot.name,
                                "trace": traceback.format_exc().splitlines()[-4:], "errors": watch.take()})
            page.unroute("**/*")
            watch.allow_5xx = False
        run.__name__ = name
        return run
    return deco


def go(page: Page, tab: str | None = None):
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    if tab:
        page.get_by_role("navigation", name="주 메뉴").get_by_role("link", name=tab, exact=True).click()
        page.wait_for_load_state("networkidle")


def my_memos():
    return [m for m in api("GET", "/memos") if TAG in m["text"]]


# ── 기록 ──────────────────────────────────────────
@case("기록: 저장 → AI 카드 → 카드 삭제 → 확인 완료 → 서버 반영")
def record_flow(page: Page):
    go(page)
    box = page.get_by_label("어떤 일이 있었나요?")
    save = page.get_by_role("button", name="저장하고 정리하기")
    expect(save).to_be_disabled()
    box.fill("   ")
    expect(save).to_be_disabled()
    box.fill(f"{TAG} 어젯밤 두 번 깨서 현관문 열려고 하심. 저녁은 반 공기밖에 안 드심.")
    save.click()
    dlg = page.get_by_role("dialog", name="정리된 내용")
    expect(dlg.get_by_role("button", name="확인 완료")).to_be_visible(timeout=90_000)
    cards = dlg.get_by_role("region", name=re.compile(r"^\d+번 "))
    n = cards.count()
    assert n >= 2, f"AI 카드 {n}개"
    expect(dlg.get_by_role("alert")).to_have_count(0)  # 응급 단어 없음
    dlg.get_by_role("button", name=re.compile(r"^1번 .* 카드 삭제$")).click()
    confirm_if_asked(page)
    expect(cards).to_have_count(n - 1)
    dlg.get_by_role("button", name="확인 완료").click()
    expect(dlg).to_be_hidden(timeout=15_000)
    m = my_memos()[0]
    assert m["status"] == "confirmed" and len(m["events"]) == n - 1, m
    rev = api("GET", f"/memos/{m['memo_id']}/revisions")
    assert [r["kind"] for r in rev] == ["최초 확인"], rev
    return f"AI 카드 {n}개 → 1개 삭제 → 서버 확정 {len(m['events'])}개"


def ack(page: Page, timeout=5000) -> str:
    """완료·오류 안내 모달(확인 버튼 하나)을 읽고 닫음. 없으면 ''."""
    d = page.locator("[role=dialog],[role=alertdialog]").filter(
        has=page.get_by_role("button", name="확인", exact=True)).last
    try:
        d.wait_for(timeout=timeout)
    except Exception:  # noqa: BLE001
        return ""
    text = d.inner_text().replace("\n", " ")
    d.get_by_role("button", name="확인", exact=True).click()
    expect(d).to_be_hidden()
    return text


def confirm_if_asked(page: Page):
    ask = page.get_by_role("alertdialog")
    if ask.count() and ask.first.is_visible():
        ask.first.get_by_role("button").last.click()


@case("기록: 응급 단어 → 응급 안내·전화 링크, 기록 삭제로 지움")
def emergency(page: Page):
    go(page)
    page.get_by_label("어떤 일이 있었나요?").fill(f"{TAG} 오후에 넘어져 머리를 부딪히셨다.")
    page.get_by_role("button", name="저장하고 정리하기").click()
    dlg = page.get_by_role("dialog", name="정리된 내용")
    alert = dlg.get_by_role("alert")
    expect(alert).to_contain_text("119", timeout=90_000)
    assert alert.get_by_role("link", name="119 전화").get_attribute("href") == "tel:119"
    expect(dlg.get_by_role("button", name="확인 완료")).to_be_visible(timeout=90_000)
    before = len(my_memos())
    dlg.get_by_role("button", name="기록 삭제").click()
    confirm_if_asked(page)
    expect(dlg).to_be_hidden(timeout=15_000)
    assert len(my_memos()) == before - 1
    return "응급 안내 표시, tel: 링크 확인, 삭제 후 서버에서 사라짐"


@case("기록: XSS 문자열은 글자로만 보임 (스크립트 실행 안 됨)")
def xss(page: Page):
    fired = []
    page.on("dialog", lambda d: d.type != "beforeunload" and (fired.append(d.message), d.dismiss()))
    go(page)
    payload = f'{TAG} <img src=x onerror="alert(1)"><script>alert(2)</script> 불안해하심'
    page.get_by_label("어떤 일이 있었나요?").fill(payload)
    page.get_by_role("button", name="저장하고 정리하기").click()
    dlg = page.get_by_role("dialog", name="정리된 내용")
    expect(dlg.get_by_text("<script>alert(2)</script>", exact=False).first).to_be_visible(timeout=90_000)
    page.wait_for_timeout(500)
    assert not fired, fired
    assert page.locator("img[src='x']").count() == 0
    dlg.get_by_role("button", name="기록 삭제").click()
    confirm_if_asked(page)
    expect(dlg).to_be_hidden(timeout=15_000)
    return "alert 0회, 삽입된 img 0개"


@case("기록: 1000자 초과 입력은 1000자에서 멈추고 글자 수 안내")
def too_long(page: Page):
    go(page)
    box = page.get_by_label("어떤 일이 있었나요?")
    box.press_sequentially("가" * 20)
    box.fill("")
    box.type(f"{TAG} " + "가" * 1100, delay=0)
    typed = len(box.input_value())
    assert typed == 1000, f"입력 {typed}자"
    expect(page.get_by_text("1000 / 1000자")).to_be_visible()
    box.fill("")
    expect(page.get_by_text(re.compile(r" / 1000자$"))).to_have_count(0)
    return f"1100자 타이핑 → {typed}자에서 멈춤, '1000 / 1000자' 표시"


@case("기록: 미래 날짜는 고를 수 없음")
def future_date(page: Page):
    go(page)
    d = page.locator("input[type=date]").first
    mx = d.get_attribute("max")
    today = time.strftime("%Y-%m-%d")
    assert mx == today, f"max={mx}"
    return f"날짜 입력 max={mx}"


@case("기록: 서버 500 → 오류 안내, 입력한 글 유지")
def server_500(page: Page, watch=None):
    go(page)
    page.route(re.compile(r"/(api/)?memos$"), lambda r: r.fulfill(status=500, content_type="application/json",
                                                     body='{"detail":"x","code":"server_error"}')
               if r.request.method == "POST" else r.continue_())
    WATCH.allow_5xx = True
    text = f"{TAG} 서버 오류 시험 메모"
    page.get_by_label("어떤 일이 있었나요?").fill(text)
    page.get_by_role("button", name="저장하고 정리하기").click()
    msg = ack(page)
    assert "저장" in msg, f"오류 안내 없음: {msg!r}"
    kept = page.get_by_label("어떤 일이 있었나요?").input_value() == text or page.get_by_text(text).count() > 0
    assert kept, "입력한 글이 사라짐"
    assert not my_memos() or all("서버 오류 시험" not in m["text"] for m in my_memos())
    return f"안내: {msg[:120]}"


@case("기록: 네트워크 끊김 → 오류 안내, 화면 멈추지 않음")
def offline(page: Page):
    go(page)
    page.route(re.compile(r"/(api/)?memos$"), lambda r: r.abort("internetdisconnected") if r.request.method == "POST" else r.continue_())
    WATCH.allow_5xx = True
    page.get_by_label("어떤 일이 있었나요?").fill(f"{TAG} 끊김 시험")
    page.get_by_role("button", name="저장하고 정리하기").click()
    msg = ack(page)
    assert "연결" in msg, f"오류 안내 없음: {msg!r}"
    page.get_by_role("navigation", name="주 메뉴").get_by_role("link", name="일정", exact=True).click()
    expect(page.get_by_role("heading", name="일정", level=1)).to_be_visible()
    return f"안내: {msg[:100]} → 다른 탭 이동 정상"


@case("기록: AI 정리 실패 응답 → 실패 안내와 직접 정리 길")
def ai_failed(page: Page):
    go(page)
    fake = {"memo_id": 999999, "status": "failed", "emergency": {"matched": False, "message": None}, "events": [],
            "text": f"{TAG} 실패 시험", "record_date": time.strftime("%Y-%m-%d"),
            "error": "이 PC의 AI 정리 프로그램에 연결하지 못했어요.", "model_output": None,
            "failure_code": "connection_error"}
    page.route(re.compile(r"/(api/)?memos$"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(fake))
               if r.request.method == "POST" else r.continue_())
    page.get_by_label("어떤 일이 있었나요?").fill(fake["text"])
    page.get_by_role("button", name="저장하고 정리하기").click()
    dlg = page.get_by_role("dialog")
    expect(dlg.get_by_text("정리하지 못했어요")).to_be_visible(timeout=15_000)
    txt = dlg.inner_text()
    assert "연결하지 못했어요" in txt or "실패" in txt, txt[:200]
    btns = [b.strip() for b in dlg.get_by_role("button").all_inner_texts() if b.strip()]
    assert any(re.search("다시|직접|추가", b) for b in btns), btns
    page.keyboard.press("Escape")
    expect(dlg).to_be_hidden()
    return f"버튼: {', '.join(btns)[:150]}"


@case("기록: 지난 기록 찾기 → 기간·상태 필터 → 열기 → 기록하기로 복귀")
def history(page: Page):
    go(page)
    page.get_by_role("button", name="지난 기록 찾기").click()
    expect(page.get_by_role("heading", level=1, name="지난 기록 찾기")).to_be_visible()
    side = page.get_by_role("complementary", name="최근 기록")
    items = side.get_by_role("listitem")
    counts = {}
    for label in ("최근 7일", "최근 30일"):
        side.get_by_role("button", name=label).click()
        page.wait_for_timeout(500)
        counts[label] = items.count()
    assert counts["최근 7일"] <= counts["최근 30일"], counts
    status = side.get_by_role("combobox", name="확인 상태")
    status.select_option("정리 실패")
    page.wait_for_timeout(500)
    counts["정리 실패"] = items.count()
    status.select_option("전체")
    first = side.get_by_role("listitem").first.get_by_role("button")
    label = first.inner_text().split("\n")[0]
    first.click()
    detail = page.get_by_role("dialog", name="정리된 내용")
    expect(detail).to_be_visible()
    opened = detail.get_by_role("heading", level=2).first.inner_text()
    page.keyboard.press("Escape")
    expect(detail).to_be_hidden()
    page.get_by_role("button", name="기록하기").click()
    expect(page.get_by_role("heading", level=1, name="오늘 하루는 어떠셨나요?")).to_be_visible()
    return f"건수 {counts}, '{label}' 열기 → '{opened}', 복귀 OK"


# ── 일정 ──────────────────────────────────────────
@case("일정: 진료 등록·중복·다음 예약 → 요약 구간 변화")
def visits(page: Page):
    go(page, "일정")
    before = {v["visit_date"] for v in api("GET", "/visits")}
    day = next(f"2026-06-{d:02d}" for d in range(1, 29) if f"2026-06-{d:02d}" not in before)
    page.get_by_role("radio", name="받은 진료").check()
    page.get_by_label("진료받은 날").fill(day)
    page.get_by_role("button", name="받은 진료 등록").click()
    ok_msg = ack(page)
    assert day in {v["visit_date"] for v in api("GET", "/visits")}, "등록 안 됨"
    page.get_by_label("진료받은 날").fill(day)
    page.get_by_role("button", name="받은 진료 등록").click()
    dup = ack(page) or " ".join(page.get_by_role("alert").all_inner_texts())
    assert "이미" in dup, f"중복 안내 없음: {dup!r}"
    per = api("GET", f"/summary/period?as_of={time.strftime('%Y-%m-%d')}")
    vid = next(v["id"] for v in api("GET", "/visits") if v["visit_date"] == day)
    api("DELETE", f"/visits/{vid}")
    page.get_by_role("radio", name="다음 예약").check()
    dates = page.locator("input[type=date]")
    mn = dates.first.get_attribute("min")
    return f"등록 {day} ({ok_msg.strip()[:20]}) → 중복 안내 '{dup.strip()[:30]}, 기준 구간 {per['baseline']}, 다음 예약 min={mn}"


@case("일정: 약 변경·질문 등록과 삭제")
def meds_questions(page: Page):
    go(page, "일정")
    name = f"{TAG}약"
    main = page.get_by_role("main")
    main.get_by_label("약 이름").fill(name)
    save = page.get_by_role("button", name="변경 내용 저장")
    page.get_by_role("radio", name="복용 시작").check()
    expect(save).to_be_enabled()
    save.click()
    ack(page)
    expect(main.get_by_text(name).first).to_be_visible(timeout=5000)
    q = f"{TAG} 밤에 깨는 것 약과 관련 있나요?"
    qs_region = main.get_by_role("region", name="의사에게 물어볼 것")
    qs_region.locator("textarea").fill(q)
    qs_region.get_by_role("button", name="질문 저장").click()
    ack(page)
    expect(qs_region.get_by_text(q).first).to_be_visible(timeout=5000)
    meds = [m for m in api("GET", "/medications") if m["name"] == name]
    qs = [x for x in api("GET", "/questions") if x["text"] == q]
    assert len(meds) == 1 and len(qs) == 1
    for m in meds:
        api("DELETE", f"/medications/{m['id']}")
    for x in qs:
        api("DELETE", f"/questions/{x['id']}")
    return "약·질문 화면 등록 → 서버 1건씩 확인 → 정리"


# ── 경과 · 요약지 ──────────────────────────────────
@case("경과: 기간 바꾸기·유형 바꾸기·거꾸로 된 기간")
def progress(page: Page):
    go(page, "경과")
    s, e = page.get_by_label("시작 날짜"), page.get_by_label("마지막 날짜")
    today = time.strftime("%Y-%m-%d")
    assert e.input_value() == today and e.get_attribute("max") == today, (e.input_value(), e.get_attribute("max"))
    s.fill("2026-08-20")
    page.wait_for_load_state("networkidle")
    combo = page.get_by_role("combobox", name="추이 유형")
    opts = combo.locator("option").all_inner_texts()
    if len(opts) > 1:
        combo.select_option(index=1)
        page.wait_for_load_state("networkidle")
    s.fill("2026-09-29")
    e.fill("2026-09-01")
    page.wait_for_timeout(1000)
    hint = page.get_by_role("alert").all_inner_texts() + page.get_by_role("status").all_inner_texts()
    now = (s.input_value(), e.input_value())
    assert now[0] <= now[1] or hint, f"거꾸로 된 기간 {now} 안내 없음"
    return f"유형 {len(opts)}개, 거꾸로 입력 → {now} {' '.join(hint)[:80]}"


@case("요약지: 불러오기·문장 틀·근거 보기·인쇄")
def summary(page: Page):
    printed = []
    page.expose_function("__printed", lambda: printed.append(1))
    page.add_init_script("window.print = () => window.__printed()")
    go(page, "요약지")
    main = page.get_by_role("main")
    expect(page.get_by_role("heading", name="핵심 요약", exact=False).first).to_be_visible(timeout=120_000)
    page.get_by_role("button", name="문장 틀로 빠르게 보기").click()
    page.wait_for_load_state("networkidle")
    ev = main.get_by_role("button", name=re.compile("관련 기록")).first
    ev.click()
    panel = page.get_by_role("heading", name="근거 원문")
    expect(panel).to_be_visible()
    page.get_by_role("button", name="근거 원문 닫기").click()
    page.get_by_role("button", name="PDF로 저장").click()
    page.wait_for_timeout(800)
    assert printed, "인쇄가 호출되지 않음"
    page.emulate_media(media="print")
    pdf = OUT / "summary.pdf"
    page.pdf(path=str(pdf), format="A4", print_background=True)
    page.emulate_media(media="screen")
    pages = pdf.read_bytes().count(b"/Type /Page") - pdf.read_bytes().count(b"/Type /Pages")
    return f"근거 패널 열고 닫기, print() 호출, A4 PDF {pages}쪽"


@case("요약지: AI 요약 대기 중 다른 탭 이동")
def summary_leave(page: Page):
    go(page, "요약지")
    page.get_by_role("button", name="새로 불러오기").click()
    page.get_by_role("navigation", name="주 메뉴").get_by_role("link", name="기록", exact=True).click()
    expect(page.get_by_role("heading", name="오늘 하루는 어떠셨나요?")).to_be_visible()
    page.wait_for_timeout(1500)
    return "대기 중 이동해도 오류 없음"


# ── 공통 품질 ──────────────────────────────────────
@case("접근성: axe (4개 탭, serious·critical)")
def a11y(page: Page):
    found = {}
    for tab in ("기록", "일정", "경과", "요약지"):
        go(page, tab)
        page.wait_for_timeout(800 if tab != "요약지" else 3000)
        page.add_script_tag(url=AXE)
        r = page.evaluate("async () => (await axe.run(document, {resultTypes:['violations']})).violations"
                          ".filter(v => ['serious','critical'].includes(v.impact))"
                          ".map(v => v.id + '×' + v.nodes.length)")
        if r:
            found[tab] = r
    assert not found, found
    return "위반 0건"


@case("키보드: Tab으로 메뉴 이동, 모달 Esc·포커스 복귀")
def keyboard(page: Page):
    go(page)
    for _ in range(6):
        page.keyboard.press("Tab")
    focused = page.evaluate("document.activeElement && (document.activeElement.innerText||document.activeElement.ariaLabel||'').slice(0,30)")
    page.get_by_role("button", name="지난 기록 찾기").focus()
    page.keyboard.press("Enter")
    expect(page.get_by_role("heading", level=1, name="지난 기록 찾기")).to_be_visible()
    page.get_by_role("button", name="기록하기").focus()
    page.keyboard.press("Enter")
    expect(page.get_by_role("heading", level=1, name="오늘 하루는 어떠셨나요?")).to_be_visible()
    # 모달: 저장 오류 안내를 띄워 포커스 가둠·Esc·복귀 확인
    page.route(re.compile(r"/(api/)?memos$"), lambda r: r.abort() if r.request.method == "POST" else r.continue_())
    WATCH.allow_5xx = True  # 일부러 끊은 요청의 콘솔 오류는 제외
    page.get_by_label("어떤 일이 있었나요?").fill(f"{TAG} 키보드")
    save = page.get_by_role("button", name="저장하고 정리하기")
    save.focus()
    page.keyboard.press("Enter")
    dlg = page.get_by_role("dialog").last
    expect(dlg).to_be_visible()
    page.wait_for_function("!!document.activeElement.closest('dialog')", timeout=3000)
    inside = True
    trapped = True
    for _ in range(6):  # 네이티브 모달: 대화상자 안 ↔ 브라우저 UI(body)만 오가고 뒤 화면 요소로는 가지 않아야 함
        page.keyboard.press("Tab")
        trapped &= page.evaluate("(a => a === document.body || !!a.closest('dialog'))(document.activeElement)")
    page.keyboard.press("Escape")
    expect(dlg).to_be_hidden()
    back = page.evaluate("document.activeElement.innerText.includes('저장하고 정리하기')")
    assert inside and trapped and back, f"열 때 포커스 {inside}, Tab 가둠 {trapped}, 닫은 뒤 복귀 {back}"
    return f"Tab 6번째 '{focused}', 화면 전환 Enter OK, 모달 포커스·가둠·Esc·복귀 OK"


@case("모바일 390px: 4개 탭 가로 넘침 없음")
def mobile(page: Page):
    page.set_viewport_size({"width": 390, "height": 844})
    over = {}
    for tab in ("기록", "일정", "경과", "요약지"):
        go(page)
        link = page.get_by_role("link", name=tab, exact=True)
        link.first.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(600)
        w = page.evaluate("document.documentElement.scrollWidth")
        if w > 390:
            over[tab] = w
        page.screenshot(path=str(OUT / f"mobile_{tab}.png"))
    page.set_viewport_size({"width": 1280, "height": 900})
    assert not over, over
    return "가로 넘침 0"


@case("성능: 첫 화면 로드")
def perf(page: Page):
    t = time.perf_counter()
    page.goto(URL)
    page.get_by_role("heading", name="오늘 하루는 어떠셨나요?").wait_for()
    first = time.perf_counter() - t
    nav = page.evaluate("JSON.stringify(performance.getEntriesByType('navigation')[0].toJSON())")
    n = json.loads(nav)
    return f"첫 화면 {first:.2f}s (DOMContentLoaded {n['domContentLoadedEventEnd']:.0f}ms, dev 서버 기준)"


WATCH: Watch


def cleanup():
    """이번·이전 실행이 남긴 E2E 데이터 정리 (이름·글에 E2E가 든 것, 이번 실행에서 만든 6월 진료)."""
    for m in api("GET", "/memos"):
        if m["text"].startswith("E2E"):
            api("DELETE", f"/memos/{m['memo_id']}")
    for m in api("GET", "/medications"):
        if m["name"].startswith("E2E"):
            api("DELETE", f"/medications/{m['id']}")
    for q in api("GET", "/questions"):
        if q["text"].startswith("E2E"):
            api("DELETE", f"/questions/{q['id']}")
    for v in api("GET", "/visits"):
        if v["visit_date"].startswith("2026-06-") and v["visit_date"] not in ORIGINAL_VISITS:
            api("DELETE", f"/visits/{v['id']}")


ORIGINAL_VISITS: set = set()


def main():
    global WATCH
    ORIGINAL_VISITS.update(v["visit_date"] for v in api("GET", "/visits") if v["visit_date"] < "2026-06-01" or v["visit_date"] > "2026-06-30")
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="ko-KR", timezone_id="Asia/Seoul")
        page = ctx.new_page()
        page.on("dialog", lambda d: d.accept() if d.type == "beforeunload" else None)
        WATCH = Watch(page)
        for fn in (record_flow, emergency, xss, too_long, future_date, server_500, offline, ai_failed, history,
                   visits, meds_questions, progress, summary, summary_leave, a11y, keyboard, mobile, perf):
            fn(page, WATCH)
            print(("PASS " if results[-1]["ok"] else "FAIL ") + results[-1]["case"], flush=True)
        b.close()
    cleanup()
    (OUT / "e2e.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{sum(r['ok'] for r in results)}/{len(results)} 통과")


if __name__ == "__main__":
    main()
