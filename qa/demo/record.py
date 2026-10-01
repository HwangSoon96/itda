"""시연 녹화: 실제 앱을 조작하며 화면 프레임(2배 해상도)과 카메라·커서·속도 지시를 기록.

  uv run --with playwright python qa/demo/record.py      # → /tmp/demo/rec/{frames/, timeline.json}
렌더는 render.py가 함 (확대·배속·커서·자막 카드는 모두 후처리).
"""

import base64
import json
import math
import shutil
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

URL = "http://127.0.0.1:8000/"
W, H, DPR = 1440, 810, 2
REC = Path("/tmp/demo/rec")
MEMO = "자다가 두 번 깨셨고, 현관문을 열고 나가려고 하셨다. 식사는 반 공기만 드셨다."  # 시간 표현 없이 카드 3개

ev: list[dict] = []
mouse = [W / 2, H / 2]


def log(kind, **kw):
    ev.append({"t": time.time(), "kind": kind, **kw})


# ── 카메라·속도·카드 지시 ──
def zoom(page: Page, box, pad=40, dur=0.9, hold=None, max_scale=1.9):
    """box: (x, y, w, h) 뷰포트 CSS px. hold가 있으면 그만큼 머문 뒤 원래대로."""
    x, y, w, h = box
    log("zoom", x=x - pad, y=y - pad, w=w + 2 * pad, h=h + 2 * pad, dur=dur, max=max_scale)
    page.wait_for_timeout(int(dur * 1000))
    if hold is not None:
        page.wait_for_timeout(int(hold * 1000))
        unzoom(page, dur)


def unzoom(page: Page, dur=0.8):
    log("zoom", x=0, y=0, w=W, h=H, dur=dur, max=1)
    page.wait_for_timeout(int(dur * 1000))


def speed(x, label=None):
    log("speed", x=x, label=label)


def card(name):
    log("card", name=name)


def rect(loc):
    b = loc.bounding_box()
    return (b["x"], b["y"], b["width"], b["height"])


# ── 사람처럼 움직이는 커서 ──
def move(page: Page, x, y, ms=None):
    sx, sy = mouse
    dist = math.hypot(x - sx, y - sy)
    ms = ms or int(min(900, max(350, dist * 0.9)))
    steps = max(8, ms // 16)
    for i in range(1, steps + 1):
        k = i / steps
        e = 1 - (1 - k) ** 3 if k < 1 else 1  # ease-out
        cx, cy = sx + (x - sx) * e, sy + (y - sy) * e
        page.mouse.move(cx, cy)
        log("mouse", x=cx, y=cy)
        page.wait_for_timeout(16)
    mouse[:] = [x, y]


def click(page: Page, loc, pause=250):
    loc.scroll_into_view_if_needed()
    x, y, w, h = rect(loc)
    move(page, x + w / 2, y + h / 2)
    page.wait_for_timeout(120)
    log("click", x=x + w / 2, y=y + h / 2)
    page.mouse.click(x + w / 2, y + h / 2)
    page.wait_for_timeout(pause)


def smooth_scroll(page: Page, to_y: float, ms=1200, in_dialog=False):
    page.evaluate(
        """([toY, ms, inDialog]) => new Promise(done => {
          const pick = () => {
            if (!inDialog) return document.scrollingElement
            const d = document.querySelector('dialog[open]')
            const all = [d, ...d.querySelectorAll('*')]
            return all.find(e => e.scrollHeight > e.clientHeight + 2 &&
              /(auto|scroll)/.test(getComputedStyle(e).overflowY)) || d
          }
          const el = pick(), from = el.scrollTop
          const to = toY < 0 ? el.scrollHeight - el.clientHeight : Math.min(toY, el.scrollHeight - el.clientHeight)
          const t0 = performance.now()
          const f = now => {
            const k = Math.min(1, (now - t0) / ms)
            const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
            el.scrollTop = from + (to - from) * e
            k < 1 ? requestAnimationFrame(f) : done()
          }
          requestAnimationFrame(f)
        })""",
        [to_y, ms, in_dialog],
    )
    page.wait_for_timeout(150)


def nav(page: Page, name):
    click(page, page.get_by_role("navigation", name="주 메뉴").get_by_role("link", name=name, exact=True))


# ── 장면 ──
def scene_record(page: Page):
    page.wait_for_timeout(900)
    box = page.get_by_label("어떤 일이 있었나요?")
    memo_card = page.get_by_role("region", name="관찰 메모 작성과 확인").locator("form").first
    zoom(page, rect(memo_card) if memo_card.count() else rect(box), pad=24, max_scale=1.45)
    click(page, box)
    speed(1.6)
    box.press_sequentially(MEMO, delay=55)
    speed(1)
    page.wait_for_timeout(500)
    save = page.get_by_role("button", name="저장하고 정리하기")
    click(page, save, pause=100)
    unzoom(page, 0.7)
    speed(2)
    dlg = page.get_by_role("dialog", name="정리된 내용")
    dlg.get_by_role("button", name="확인 완료").wait_for(timeout=90_000)
    page.wait_for_timeout(300)
    speed(1)
    page.wait_for_timeout(900)
    first = dlg.get_by_role("region", name="1번 야간 각성")
    heading = dlg.get_by_role("heading", name="정리된 내용 3건")
    smooth_scroll(page, 0, 10, in_dialog=True)
    top = rect(heading)[1] - 20
    smooth_scroll(page, top - 90, 1100, in_dialog=True) if top > 200 else None
    # 카드 3개가 한눈에 보이게 확대
    cards = [rect(dlg.get_by_role("region", name=n)) for n in ("1번 야간 각성", "2번 배회·출입문 시도")]
    x0 = min(c[0] for c in cards)
    y0 = rect(heading)[1]
    x1 = max(c[0] + c[2] for c in cards)
    y1 = max(c[1] + c[3] for c in cards)
    zoom(page, (x0, y0, x1 - x0, y1 - y0), pad=20, hold=2.4, max_scale=1.5)
    smooth_scroll(page, -1, 1400, in_dialog=True)
    page.wait_for_timeout(700)
    third = dlg.get_by_role("region", name="3번 식사량 감소")
    zoom(page, rect(third), pad=30, hold=1.6, max_scale=1.5)
    click(page, dlg.get_by_role("button", name="확인 완료"), pause=600)
    page.wait_for_timeout(800)
    ok = page.locator("dialog[open]").get_by_role("button", name="확인", exact=True)
    ok.wait_for(timeout=5000)
    page.wait_for_timeout(900)
    click(page, ok, pause=500)
    recent = page.get_by_role("region", name="최근 기록")
    smooth_scroll(page, page.evaluate(
        "() => { const r=[...document.querySelectorAll('h2')].find(h=>h.textContent.trim()==='최근 기록'); "
        "return r ? r.getBoundingClientRect().top + scrollY - 260 : 0 }"), 1300)
    zoom(page, rect(recent), pad=24, hold=1.8, max_scale=1.6)
    smooth_scroll(page, 0, 900)


def scene_progress(page: Page):
    page.wait_for_timeout(400)
    nav(page, "경과")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1200)
    main = page.get_by_role("main")
    zoom(page, rect(main.locator(".mvp-progress-cards")), pad=14, hold=3.0, max_scale=1.4)
    smooth_scroll(page, 330, 1100)
    page.wait_for_timeout(300)
    zoom(page, rect(main.locator(".mvp-progress-chart")), pad=14, max_scale=1.45)
    page.wait_for_timeout(1500)
    combo = main.get_by_role("combobox", name="추이 유형")
    for label in ("배회·출입문 시도", "환각"):
        x, y, w, h = rect(combo)
        move(page, x + w / 2, y + h / 2)
        log("click", x=x + w / 2, y=y + h / 2)
        combo.select_option(label=label)
        page.wait_for_timeout(1900)
    unzoom(page)
    click(page, main.get_by_role("button", name="관련 기록 보기", exact=True), pause=900)
    dlg = page.get_by_role("dialog").last
    dlg.wait_for()
    page.wait_for_timeout(400)
    zoom(page, rect(dlg), pad=10, hold=2.8, max_scale=1.4)
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    smooth_scroll(page, 0, 800)


def scene_summary(page: Page):
    page.wait_for_timeout(400)
    speed(3, "3× 빠르게")
    nav(page, "요약지")
    page.get_by_role("heading", name="핵심 요약").first.wait_for(timeout=120_000)
    main = page.get_by_role("main")
    page.wait_for_timeout(600)
    speed(1)
    zoom(page, rect(main.locator(".v2-core-summary").first), pad=18, hold=3.2, max_scale=1.8)
    # 핵심 요약 문장 → 근거 원문
    click(page, main.locator(".v2-core-summary li button, .v2-core-summary button").nth(2), pause=900)
    zoom(page, rect(page.get_by_role("heading", name="근거 원문").locator("xpath=ancestor::*[self::aside or self::section][1]")),
         pad=14, hold=2.6, max_scale=1.5)
    table = main.get_by_role("table").first
    tb = rect(table)
    smooth_scroll(page, page.evaluate("scrollY") + tb[1] - 150, 1300)
    tb = rect(table)
    zoom(page, (tb[0], tb[1], tb[2], 150), pad=16, hold=2.2, max_scale=1.8)
    # 영역별 변화 → 환각 행 근거
    click(page, table.get_by_role("button", name="환각 관련 기록 보기"), pause=900)
    panel = page.get_by_role("heading", name="근거 원문").locator("xpath=ancestor::*[self::aside or self::section][1]")
    pb = rect(panel)
    zoom(page, (tb[0], tb[1], pb[0] + pb[2] - tb[0], max(150, pb[1] + pb[3] - tb[1])), pad=14, hold=2.8, max_scale=1.5)
    q = main.get_by_role("heading", name="보호자가 묻고 싶은 것").first
    smooth_scroll(page, page.evaluate("scrollY") + rect(q)[1] - 380, 1300)
    page.wait_for_timeout(1200)
    detail = main.get_by_role("heading", name="경과 요약지 · 상세").first
    smooth_scroll(page, page.evaluate("scrollY") + rect(detail)[1] - 110, 1800)
    page.wait_for_timeout(1500)
    smooth_scroll(page, page.evaluate("scrollY") + 520, 1500)
    page.wait_for_timeout(900)
    smooth_scroll(page, 0, 1400)
    page.wait_for_timeout(300)
    click(page, main.get_by_role("button", name="PDF로 저장"), pause=900)
    rv = page.get_by_role("dialog", name="출력 전 기록 확인")
    if rv.count() and rv.is_visible():
        zoom(page, rect(rv), pad=10, hold=2.4, max_scale=1.35)
        click(page, rv.get_by_role("button", name="확인된 기록만 출력"), pause=0)
    help_dlg = page.get_by_role("dialog", name="PDF 저장 안내")
    help_dlg.wait_for(timeout=5000)
    page.wait_for_timeout(250)
    zoom(page, rect(help_dlg), pad=16, max_scale=1.5)  # 인쇄 안내·주소를 읽을 수 있게
    help_dlg.wait_for(state="hidden", timeout=10_000)
    unzoom(page, 0.9)
    page.wait_for_timeout(1300)
    log("pdf")  # 요약지를 잠깐 보여 준 뒤 PDF 결과로 넘어감
    page.emulate_media(media="print")
    page.pdf(path=str(REC / "summary.pdf"), format="A4", print_background=True)
    page.emulate_media(media="screen")


def main():
    shutil.rmtree(REC, ignore_errors=True)
    (REC / "frames").mkdir(parents=True)
    frames = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=DPR,
                            locale="ko-KR", timezone_id="Asia/Seoul")
        ctx.add_init_script("""
          window.print = () => setTimeout(() => dispatchEvent(new Event("afterprint")), 2600);
          addEventListener('DOMContentLoaded', () => {
            const s = document.createElement('style');
            s.textContent = 'html{scrollbar-width:none} ::-webkit-scrollbar{display:none} *{caret-color:#1b426d}';
            document.head.append(s);
          });""")
        page = ctx.new_page()
        page.on("dialog", lambda d: d.accept())
        page.goto(URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)
        cdp = ctx.new_cdp_session(page)

        def on_frame(f):
            n = len(frames)
            (REC / "frames" / f"{n:05d}.jpg").write_bytes(base64.b64decode(f["data"]))
            frames.append(f["metadata"]["timestamp"])
            cdp.send("Page.screencastFrameAck", {"sessionId": f["sessionId"]})

        cdp.on("Page.screencastFrame", on_frame)
        cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W * DPR,
                                          "maxHeight": H * DPR, "everyNthFrame": 1})
        page.wait_for_timeout(600)
        log("start")
        move(page, W * 0.62, H * 0.55, 400)
        page.wait_for_timeout(600)
        try:
            scene_record(page)
            scene_progress(page)
            scene_summary(page)
        except Exception:
            page.screenshot(path="/tmp/demo/fail.png")
            raise
        page.wait_for_timeout(500)
        log("end")
        cdp.send("Page.stopScreencast")
        b.close()
    (REC / "timeline.json").write_text(json.dumps({"frames": frames, "events": ev, "W": W, "H": H, "DPR": DPR},
                                                  ensure_ascii=False))
    print(len(frames), "frames", round(frames[-1] - frames[0], 1), "s")


if __name__ == "__main__":
    main()
