"""녹화 프레임 + timeline.json → 1920×1080 60fps MP4.

카메라 확대(부드러운 이징), 구간 배속, 가짜 커서·클릭 물결, 자막 카드, PDF 결과 장면을 합성한다.
  uv run --with pillow --with pymupdf python qa/demo/render.py [출력.mp4]
"""

import bisect
import json
import math
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REC = Path("/tmp/demo/rec")
CARDS = Path("/tmp/demo/cards")
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/demo/itda_demo.mp4")
OW, OH, FPS = 1920, 1080, 60
FONT = str(Path.home() / "itda/frontend/public/fonts/Binggrae-Bold.ttf")

tl = json.loads((REC / "timeline.json").read_text())
FT, EV, W, H, DPR = tl["frames"], tl["events"], tl["W"], tl["H"], tl["DPR"]
T0 = FT[0]
for e in EV:
    e["s"] = e["t"] - T0
S_START = next(e["s"] for e in EV if e["kind"] == "start")
S_END = next(e["s"] for e in EV if e["kind"] == "pdf") + 0.25


def ease(k):
    k = min(1.0, max(0.0, k))
    return 4 * k ** 3 if k < 0.5 else 1 - (-2 * k + 2) ** 3 / 2


# ── 원본 프레임 ──
@lru_cache(maxsize=6)
def frame(i):
    return Image.open(REC / "frames" / f"{i:05d}.jpg").convert("RGB")


def frame_at(s):
    return frame(max(0, bisect.bisect_right(FT, T0 + s) - 1))


# ── 카메라: (확대 배율, 중심 x, 중심 y) CSS px ──
def fit(e):
    s = min(W / e["w"], H / e["h"], e["max"])
    s = max(1.0, s)
    cx, cy = e["x"] + e["w"] / 2, e["y"] + e["h"] / 2
    hw, hh = W / 2 / s, H / 2 / s
    return s, min(max(cx, hw), W - hw), min(max(cy, hh), H - hh)


ZOOMS = [e for e in EV if e["kind"] == "zoom"]


def camera(s):
    cur = (1.0, W / 2, H / 2)
    for e in ZOOMS:
        if e["s"] > s:
            break
        tgt = fit(e)
        k = ease((s - e["s"]) / e["dur"])
        a, b = math.log(cur[0]), math.log(tgt[0])
        cur = (math.exp(a + (b - a) * k), cur[1] + (tgt[1] - cur[1]) * k, cur[2] + (tgt[2] - cur[2]) * k)
    return cur


# ── 커서 ──
MOUSE = [(e["s"], e["x"], e["y"]) for e in EV if e["kind"] == "mouse"]
MS = [m[0] for m in MOUSE]
CLICKS = [(e["s"], e["x"], e["y"]) for e in EV if e["kind"] == "click"]


def cursor_at(s):
    i = bisect.bisect_right(MS, s) - 1
    if i < 0:
        return W * 0.5, H * 0.5, 0.0
    x, y = MOUSE[i][1], MOUSE[i][2]
    idle = s - MOUSE[i][0]
    last_click = max((c[0] for c in CLICKS if c[0] <= s), default=-9)
    idle = min(idle, s - last_click)
    alpha = 1.0 if idle < 1.4 else max(0.0, 1 - (idle - 1.4) / 0.4)  # 가만히 있으면 사라짐
    return x, y, alpha


def make_cursor():
    k = 4
    pts = [(0, 0), (0, 17), (4.2, 13.2), (7, 19.5), (9.6, 18.4), (6.9, 12.3), (12.3, 12.3)]
    im = Image.new("RGBA", (16 * k, 23 * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    p = [(x * k + 2 * k, y * k + 1.5 * k) for x, y in pts]
    shadow = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x + 1.2 * k, y + 1.6 * k) for x, y in p], fill=(0, 0, 0, 90))
    im = Image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(k * 1.2)), im)
    d = ImageDraw.Draw(im)
    d.polygon(p, fill=(20, 24, 32, 255))
    inner = [(x * k * 0.78 + 2 * k + 1.1 * k, y * k * 0.78 + 1.5 * k + 2.6 * k) for x, y in pts]
    d.polygon(inner, fill=(255, 255, 255, 255))
    return im.resize((16 * 2, 23 * 2), Image.LANCZOS)


CURSOR = make_cursor()


def draw_cursor(img, s, cam):
    sc, cx, cy = cam
    x, y, a = cursor_at(s)
    ox = (x - (cx - W / 2 / sc)) * sc * OW / W
    oy = (y - (cy - H / 2 / sc)) * sc * OH / H
    size = 1.0 + (sc - 1) * 0.35
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for cs, x0, y0 in CLICKS:  # 클릭 물결
        dt = s - cs
        if 0 <= dt < 0.55:
            k = dt / 0.55
            r = (10 + 34 * ease(k)) * size
            px = (x0 - (cx - W / 2 / sc)) * sc * OW / W
            py = (y0 - (cy - H / 2 / sc)) * sc * OH / H
            d.ellipse((px - r, py - r, px + r, py + r), fill=(27, 66, 109, int(70 * (1 - k))),
                      outline=(27, 66, 109, int(200 * (1 - k))), width=3)
    press = any(0 <= s - c[0] < 0.12 for c in CLICKS)
    if a > 0:
        cur = CURSOR
        f = size * (0.86 if press else 1.0)
        if f != 1:
            cur = cur.resize((max(1, int(cur.width * f)), max(1, int(cur.height * f))), Image.LANCZOS)
        if a < 1:
            cur = cur.copy()
            cur.putalpha(cur.getchannel("A").point(lambda v: int(v * a)))
        ov.alpha_composite(cur, (int(ox - 2 * f), int(oy - 2 * f)))
    return Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")


# ── 배속 배지 ──
BADGE_FONT = ImageFont.truetype(FONT, 30)


def badge(img, text):
    d = ImageDraw.Draw(img, "RGBA")
    tw = d.textlength(text, font=BADGE_FONT)
    x1, y0 = OW - 48, 44
    x0 = x1 - tw - 56
    d.rounded_rectangle((x0, y0, x1, y0 + 58), radius=29, fill=(15, 47, 87, 215))
    d.polygon([(x0 + 22, y0 + 18), (x0 + 22, y0 + 40), (x0 + 36, y0 + 29)], fill=(127, 209, 174, 255))
    d.text((x0 + 44, y0 + 12), text, font=BADGE_FONT, fill=(255, 255, 255, 255))
    return img


def app_frame(s, label=None):
    sc, cx, cy = cam = camera(s)
    src = frame_at(s)
    k = src.width / W  # 원본 px / CSS px
    box = ((cx - W / 2 / sc) * k, (cy - H / 2 / sc) * k, (cx + W / 2 / sc) * k, (cy + H / 2 / sc) * k)
    img = src.resize((OW, OH), Image.LANCZOS, box=box)
    img = draw_cursor(img, s, cam)
    return badge(img, label) if label else img


# ── 출력 타임라인 ──
def card(name):
    return Image.open(CARDS / f"{name}.png").convert("RGB")


def pdf_scene():
    import pymupdf

    doc = pymupdf.open(REC / "summary.pdf")
    ims = []
    for pg in list(doc)[:2]:
        pix = pg.get_pixmap(dpi=170)
        ims.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    base = Image.new("RGB", (OW, OH), (82, 86, 89))  # 브라우저 PDF 보기 배경
    ph = 960
    ims = [im.resize((int(im.width * ph / im.height), ph), Image.LANCZOS) for im in ims]
    gap = 60
    total = sum(i.width for i in ims) + gap * (len(ims) - 1)
    x = (OW - total) // 2
    y = (OH - ph) // 2
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    xx = x
    for im in ims:
        sd.rounded_rectangle((xx + 6, y + 14, xx + im.width + 6, y + ph + 14), 8, fill=(0, 0, 0, 110))
        xx += im.width + gap
    comp = Image.alpha_composite(base.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(10))).convert("RGB")
    for im in ims:
        comp.paste(im, (x, y))
        x += im.width + gap
    return comp


def build():
    """(길이, 그리기 함수) 목록."""
    segs = []
    speeds = sorted([(e["s"], e["x"], e.get("label")) for e in EV if e["kind"] == "speed"])
    cards = [(e["s"], e["name"]) for e in EV if e["kind"] == "card"]
    cuts = sorted({S_START, S_END, *[c[0] for c in cards], *[sp[0] for sp in speeds]})
    cuts = [c for c in cuts if S_START <= c <= S_END]

    def rate_at(s):
        r, lab = 1.0, None
        for t, x, label in speeds:
            if t <= s:
                r, lab = x, label
        return r, lab

    for a, b in zip(cuts, cuts[1:]):
        for cs, name in cards:
            if abs(cs - a) < 1e-9:
                segs.append(("card", 1.9, card(name), cs))
        r, lab = rate_at(a)
        segs.append(("app", (b - a) / r, a, r, lab))
    segs.append(("pdf", 6.5, pdf_scene()))
    return segs


def render():
    segs = build()
    total = sum(s[1] for s in segs)
    print(f"출력 {total:.1f}s, {len(segs)}개 구간", flush=True)
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{OW}x{OH}",
         "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", str(OUT)], stdin=subprocess.PIPE)
    prev_last = None
    n = 0
    for idx, seg in enumerate(segs):
        kind, dur = seg[0], seg[1]
        count = round(dur * FPS)
        nxt = segs[idx + 1] if idx + 1 < len(segs) else None
        for i in range(count):
            t = i / FPS
            if kind == "app":
                _, _, a, r, lab = seg
                img = app_frame(a + t * r, lab)
                if idx == 0 and t < 0.6:  # 시작은 검은 화면에서 천천히
                    img = Image.blend(Image.new("RGB", (OW, OH), (0, 0, 0)), img, ease(t / 0.6))
            elif kind == "card":
                c, cs = seg[2], seg[3]
                fade = 0.35
                if t < fade:  # 들어올 때: 직전 화면에서 (첫 카드는 남색 바탕에서)
                    base = prev_last if prev_last is not None else Image.new("RGB", (OW, OH), (15, 47, 87))
                    img = Image.blend(base, c, ease(t / fade))
                elif dur - t < fade:  # 나갈 때: 앱 화면으로
                    img = Image.blend(app_frame(cs), c, ease((dur - t) / fade))
                else:
                    img = c
            elif kind == "pdf":
                comp = seg[2]
                z = 1 + 0.05 * ease(t / dur)
                cw, ch = OW / z, OH / z
                img = comp.resize((OW, OH), Image.LANCZOS, box=((OW - cw) / 2, (OH - ch) / 2, (OW + cw) / 2, (OH + ch) / 2))
                if t < 1.1 and prev_last is not None:  # 요약지 → PDF 천천히
                    img = Image.blend(prev_last, img, ease(t / 1.1))
                if dur - t < 0.8:
                    img = Image.blend(img, Image.new("RGB", (OW, OH), (0, 0, 0)), ease(1 - (dur - t) / 0.8))
            else:  # still
                img = seg[2]
                if t < 0.5 and prev_last is not None:
                    img = Image.blend(prev_last, img, ease(t / 0.5))
                if nxt is None and dur - t < 0.6:
                    img = Image.blend(img, Image.new("RGB", (OW, OH), (15, 47, 87)), ease(1 - (dur - t) / 0.6))
            ff.stdin.write(img.tobytes())
            last = img
            n += 1
            if n % 600 == 0:
                print(f"  {n / FPS:.0f}s / {total:.0f}s", flush=True)
        prev_last = last if count else prev_last
    ff.stdin.close()
    ff.wait()
    print("완료", OUT)


if __name__ == "__main__":
    render()
