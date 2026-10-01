"""자막 카드(1920×1080 PNG): 시연 표지 + 단계별 강조 + 끝 카드. 발표 슬라이드와 같은 짙은 남색 톤."""

from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path("/tmp/demo/cards")
PUB = Path.home() / "itda/frontend/public"
STEPS = [("1", "메모 입력", "결과 카드 → 확인 완료"), ("2", "경과 확인", "유형별 비율 · 주간 추이"),
         ("3", "진료용 요약지", "AI 요약 · 증가 표시 · PDF")]

CSS = f"""
@font-face {{ font-family: B; src: url('file://{PUB}/fonts/Binggrae-Bold.ttf'); font-weight: 700; }}
@font-face {{ font-family: B; src: url('file://{PUB}/fonts/Binggrae.ttf'); font-weight: 400; }}
* {{ margin: 0; box-sizing: border-box; }}
body {{ width: 1920px; height: 1080px; overflow: hidden; font-family: B, 'Noto Sans KR', sans-serif;
  background: linear-gradient(135deg, #0f2f57 0%, #163f6e 55%, #1b4a7d 100%); color: #fff; position: relative; }}
.orb {{ position: absolute; right: -180px; bottom: -260px; width: 820px; height: 820px; border-radius: 50%;
  background: rgba(255,255,255,.06); }}
.wrap {{ position: absolute; inset: 0; padding: 150px 150px; display: flex; flex-direction: column; }}
h1 {{ font-size: 150px; font-weight: 700; letter-spacing: -2px; line-height: 1; }}
.row {{ display: flex; gap: 36px; margin-top: 110px; }}
.c {{ flex: 1; border-radius: 34px; padding: 44px 46px 48px; background: rgba(255,255,255,.08);
  border: 2px solid rgba(255,255,255,.14); transition: none; }}
.c b {{ display: block; color: #7fd1ae; font-size: 40px; font-weight: 700; }}
.c h2 {{ font-size: 58px; margin-top: 18px; font-weight: 700; }}
.c p {{ font-size: 32px; margin-top: 18px; color: rgba(255,255,255,.72); }}
.dim {{ opacity: .32; }}
.on {{ background: rgba(255,255,255,.16); border-color: #7fd1ae; box-shadow: 0 0 0 4px rgba(127,209,174,.25); }}
.foot {{ margin-top: auto; font-size: 30px; color: rgba(255,255,255,.55); }}
.brand {{ display: flex; align-items: center; gap: 22px; font-size: 64px; font-weight: 700; }}
.brand img {{ width: 120px; height: 120px; border-radius: 28px; background: #fff; padding: 12px; }}
.center {{ align-items: center; justify-content: center; text-align: center; }}
.sub {{ margin-top: 30px; font-size: 38px; color: rgba(255,255,255,.75); }}
"""


def steps(active=None):
    out = []
    for n, t, d in STEPS:
        cls = "c" if active is None else ("c on" if n == active else "c dim")
        out.append(f'<div class="{cls}"><b>{n}</b><h2>{t}</h2><p>{d}</p></div>')
    return '<div class="row">' + "".join(out) + "</div>"


def page(body):
    return f"<html><head><style>{CSS}</style></head><body><div class='orb'></div>{body}</body></html>"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    foot = '<div class="foot">가상 환자 박OO · 약 두 달(8/1 ~ 9/29) 관찰 메모 51건을 불러온 상태에서 시작</div>'
    cards = {
        "intro": page(f'<div class="wrap"><h1>시연</h1>{steps()}{foot}</div>'),
        **{n: page(f'<div class="wrap"><h1>시연</h1>{steps(n)}{foot}</div>') for n, _, _ in STEPS},
        "pdf": page('<div class="wrap" style="padding:70px 150px"><div class="brand" style="font-size:44px">'
                    '진료실에 가져가는 PDF 요약지</div></div>'),
        "outro": page(f'<div class="wrap center"><div class="brand"><img src="file://{PUB}/assets/logo.png">잇다</div>'
                      '<div class="sub">보호자 관찰 기록 정리</div></div>'),
    }
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1920, "height": 1080})
        for name, html in cards.items():
            f = OUT / f"{name}.html"
            f.write_text(html, encoding="utf-8")
            pg.goto(f.as_uri())
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT / f"{name}.png"))
        b.close()


if __name__ == "__main__":
    main()
