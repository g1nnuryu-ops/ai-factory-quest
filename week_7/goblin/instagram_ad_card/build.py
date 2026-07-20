# -*- coding: utf-8 -*-
"""계영배 통대관 광고 카드 빌더 — brand/brand.json 값만 사용한다."""
import base64, json, pathlib

ROOT = pathlib.Path(__file__).parent
B = json.loads((ROOT / "brand" / "brand.json").read_text(encoding="utf-8"))
C = B["color"]
R = B["rental"]

# 카드에 반복해 쓰는 대관 문구 — 전부 brand.json에서 조립한다
OFFER = f'{R["time"]} 통대관 {R["price"]}'          # 18:00–23:30 통대관 21만원
CAP = R["capacity"]                                  # 최대 10인


def b64(name):
    return base64.b64encode((ROOT / "assets" / name).read_bytes()).decode()


BASE = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>%(title)s</title>
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:%(bg)s;--ink:%(ink)s;--accent:%(accent)s;--dim:%(dim)s}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;background:var(--bg)}
body{font-family:'Pretendard',sans-serif;-webkit-font-smoothing:antialiased}
.card{position:relative;width:1080px;height:1080px;background:var(--bg);overflow:hidden}
.kicker{font-family:'Cormorant Garamond',serif;font-weight:500;letter-spacing:.34em;
        text-transform:uppercase;color:var(--accent)}
.copy{font-weight:700;color:var(--ink);letter-spacing:-.015em;word-break:keep-all}
.meta{color:var(--dim);font-weight:400;letter-spacing:-.005em;word-break:keep-all}
.cta{font-weight:600;color:var(--accent);letter-spacing:-.01em}
.cta .ar{margin-left:12px}
.rule{border-top:1px solid rgba(242,237,231,.13)}
%(css)s
</style></head><body><div class="card">%(body)s</div></body></html>"""


def page(title, css, body):
    return BASE % dict(title=title, bg=C["bg"], ink=C["ink"], accent=C["accent"],
                       dim=C["ink_dim"], css=css, body=body)


CTA = '<div class="cta">프로필 링크에서 대관 예약<span class="ar">&rarr;</span></div>'

CARDS = {}

# ── v2 — v1 반영본: CTA를 예약 링크로, 통대관 조건 1줄 추가 ──────────────
CARDS["v2"] = page(
    "계영배 통대관 — v2",
    """
.hero{position:absolute;inset:0 0 auto 0;height:646px}
.hero img{width:1080px;height:646px;object-fit:cover;display:block}
.hero::after{content:"";position:absolute;left:0;right:0;bottom:0;height:190px;
  background:linear-gradient(180deg,rgba(10,7,8,0),rgba(10,7,8,.72) 55%,var(--bg))}
.band{position:absolute;left:0;right:0;bottom:0;height:434px;padding:38px 96px 46px;
  display:flex;flex-direction:column}
.kicker{font-size:26px}
.copy{margin-top:18px;font-size:82px;line-height:1.22}
.meta{margin-top:20px;font-size:26px}
.foot{margin-top:auto;padding-top:26px}
.cta{font-size:36px}
""",
    f"""<div class="hero"><img src="data:image/jpeg;base64,{b64('hero.jpg')}"></div>
<div class="band">
  <div class="kicker">Private Event &middot; 을지로</div>
  <div class="copy">당신의 밤을,<br>통째로.</div>
  <div class="meta">{OFFER} &middot; {CAP} &middot; {R["byob"]}</div>
  <div class="foot rule">{CTA}</div>
</div>""")

# ── A — 몰입형: 공간 풀블리드 + 스크림 ─────────────────────────────────
CARDS["alt-a"] = page(
    "계영배 통대관 — A 몰입형",
    """
.hero{position:absolute;inset:0}
.hero img{width:1080px;height:1080px;object-fit:cover;display:block}
.scrim{position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(10,7,8,0) 34%,rgba(10,7,8,.80) 66%,rgba(10,7,8,.96))}
.band{position:absolute;left:0;right:0;bottom:0;padding:0 96px 62px}
.kicker{font-size:25px}
.copy{margin-top:20px;font-size:78px;line-height:1.24}
.meta{margin-top:18px;font-size:25px}
.foot{margin-top:34px;padding-top:26px}
.cta{font-size:35px}
""",
    f"""<div class="hero"><img src="data:image/jpeg;base64,{b64('alt-a-space.jpg')}"></div>
<div class="scrim"></div>
<div class="band">
  <div class="kicker">Private Event &middot; 을지로</div>
  <div class="copy">오늘 밤은,<br>당신만 받습니다.</div>
  <div class="meta">바 전체를 통째로 &middot; {OFFER} &middot; {CAP}</div>
  <div class="foot rule">{CTA}</div>
</div>""")

# ── B — 정보형: 예약을 검토하는 사람에게 필요한 조건을 보여준다 ──────────
# 표가 숫자를 다 말하므로 카피는 숫자를 반복하지 않는다.
# 각 항목의 부제는 상위 항목을 되풀이하지 않고 새 정보를 얹는다.
SPECS = [(R["price"], f'{R["time"]} · {R["duration"]}'),
         (R["capacity"], R["area"]),
         ("주류·음식 반입", "광장시장서 포장 OK"),
         ("을지로4가역", "4번 출구 도보 2분")]
spec_html = "".join(
    f'<div class="sp"><div class="sp-k">{k}</div><div class="sp-v">{v}</div></div>'
    for k, v in SPECS)

CARDS["alt-b"] = page(
    "계영배 통대관 — B 정보형",
    """
.hero{position:absolute;inset:0 0 auto 0;height:520px}
.hero img{width:1080px;height:520px;object-fit:cover;display:block}
.hero::after{content:"";position:absolute;left:0;right:0;bottom:0;height:170px;
  background:linear-gradient(180deg,rgba(10,7,8,0),rgba(10,7,8,.75) 55%,var(--bg))}
.band{position:absolute;left:0;right:0;bottom:0;height:560px;padding:26px 96px 46px;
  display:flex;flex-direction:column}
.kicker{font-size:25px}
.copy{margin-top:16px;font-size:70px;line-height:1.2}
.specs{margin-top:34px;display:grid;grid-template-columns:1fr 1fr;gap:26px 40px}
.sp-k{font-size:31px;font-weight:600;color:var(--ink);letter-spacing:-.01em}
.sp-v{margin-top:5px;font-size:23px;color:var(--dim)}
.foot{margin-top:auto;padding-top:26px}
.cta{font-size:35px}
""",
    f"""<div class="hero"><img src="data:image/jpeg;base64,{b64('alt-b-band.jpg')}"></div>
<div class="band">
  <div class="kicker">Private Event &middot; 을지로</div>
  <div class="copy">이 밤을,<br>통째로 빌리다.</div>
  <div class="specs">{spec_html}</div>
  <div class="foot rule">{CTA}</div>
</div>""")

# ── C — 미니멀 여백형: 네온 하나만 띄운다 ──────────────────────────────
CARDS["alt-c"] = page(
    "계영배 통대관 — C 미니멀",
    """
.wrap{position:absolute;inset:0;padding:120px 96px 62px;display:flex;flex-direction:column;
  align-items:center;text-align:center}
/* 가장자리 페더링은 이미지에 구워 넣었다 — CSS mask는 반경 계산이 어긋나
   사각 테두리가 남는다 (radial 44%/78% 스톱이 박스 밖에서 끝남) */
.neon{width:672px;height:413px;object-fit:cover;display:block}
.kicker{margin-top:62px;font-size:25px}
.copy{margin-top:26px;font-size:80px;line-height:1.26}
.meta{margin-top:22px;font-size:25px}
.foot{margin-top:auto;padding-top:26px;width:100%}
.cta{font-size:35px}
""",
    f"""<div class="wrap">
  <img class="neon" src="data:image/jpeg;base64,{b64('alt-c-neon.jpg')}">
  <div class="kicker">Private Event</div>
  <div class="copy">오늘 밤,<br>여기는 당신 것.</div>
  <div class="meta">{OFFER} &middot; {CAP}</div>
  <div class="foot rule">{CTA}</div>
</div>""")

# ══════════════════════════════════════════════════════════════════════
#  3장 캐러셀 — 1 후킹 / 2 본문 / 3 CTA
#  세 장이 한 세트로 읽혀야 하므로 아래를 전부 고정한다:
#    · 구조   상단 사진 밴드 + 하단 검정 밴드
#    · 여백   좌우 96px
#    · 정렬   전부 왼쪽 (장마다 정렬이 바뀌면 세트로 안 읽힌다)
#    · 타입   kicker 26 / copy 76~80 / meta 25 / foot 30
#  1·2장 우하단에는 다음 장으로 넘길 이유를 준다. 3장에는 두지 않는다.
# ══════════════════════════════════════════════════════════════════════

CAR_CSS = """
.hero{position:absolute;inset:0 0 auto 0}
.hero img{width:1080px;display:block}
.hero::after{content:"";position:absolute;left:0;right:0;bottom:0;height:180px;
  background:linear-gradient(180deg,rgba(10,7,8,0),rgba(10,7,8,.72) 55%,var(--bg))}
.band{position:absolute;left:0;right:0;bottom:0;padding:0 96px 46px;
  display:flex;flex-direction:column}
.kicker{font-size:26px}
.copy{font-size:78px;line-height:1.22}
.meta{font-size:25px}
.foot{margin-top:auto;padding-top:26px;display:flex;align-items:baseline;
  justify-content:space-between}
.foot-l{font-size:25px;color:var(--dim)}
.next{font-size:30px;font-weight:600;color:var(--accent)}
.next .ar{margin-left:10px}
"""

CAROUSEL = {}

# ── 1장 · 후킹 ─────────────────────────────────────────────────────────
# 그리드 썸네일로 남는 건 이 장뿐이다 → 가장 강한 컷을 쓰고, 조건은 넣지 않는다.
CAROUSEL["car-1"] = page(
    "계영배 통대관 캐러셀 1/3 — 후킹",
    CAR_CSS + """
.hero,.hero img{height:660px}
.band{height:420px;padding-top:38px}
.copy{margin-top:18px}
""",
    f"""<div class="hero"><img src="data:image/jpeg;base64,{b64('car-1.jpg')}"></div>
<div class="band">
  <div class="kicker">Private Event &middot; 을지로</div>
  <div class="copy">오늘 밤은,<br>당신만 받습니다.</div>
  <div class="foot rule">
    <div class="foot-l">바 전체 통대관</div>
    <div class="next">조건 보기<span class="ar">&rarr;</span></div>
  </div>
</div>""")

# ── 2장 · 본문 ─────────────────────────────────────────────────────────
# 헤드라인은 말로, 숫자는 표로. 서로 반복하지 않게 나눈다.
car_specs = "".join(
    f'<div class="sp"><div class="sp-k">{k}</div><div class="sp-v">{v}</div></div>'
    for k, v in SPECS)

CAROUSEL["car-2"] = page(
    "계영배 통대관 캐러셀 2/3 — 본문",
    CAR_CSS + """
.hero,.hero img{height:500px}
.band{height:580px;padding-top:34px}
.copy{margin-top:16px;font-size:66px}
.specs{margin-top:38px;display:grid;grid-template-columns:1fr 1fr;gap:28px 40px}
.sp-k{font-size:31px;font-weight:600;color:var(--ink);letter-spacing:-.01em}
.sp-v{margin-top:5px;font-size:23px;color:var(--dim)}
""",
    f"""<div class="hero"><img src="data:image/jpeg;base64,{b64('car-2.jpg')}"></div>
<div class="band">
  <!-- 키커는 라틴 전용 스타일(자간 .34em)이다. 한글을 넣으면 자모가 벌어져
       "이 렇 게  빌 립 니 다"로 읽힌다 → 세 장 모두 라틴으로 통일 -->
  <div class="kicker">How It Works</div>
  <div class="copy">바 하나를,<br>통째로.</div>
  <div class="specs">{car_specs}</div>
  <div class="foot rule">
    <div class="foot-l">{R["facilities"].split(" · ")[0]} 구비 &middot; {R["staff"].split(" (")[0]}</div>
    <div class="next">예약 방법<span class="ar">&rarr;</span></div>
  </div>
</div>""")

# ── 3장 · CTA ─────────────────────────────────────────────────────────
# 카피 자체가 CTA다. 별도 CTA 줄을 또 두면 같은 말을 두 번 하게 된다.
#
# 사진: 천장의 붉은 제등을 올려다본 컷.
#   처음엔 1장과 같은 벽(네온 사인)을 썼는데 두 장이 거의 같은 그림이 됐다.
#   세 장은 '다른 각도'가 아니라 '다른 피사체'여야 세트로 읽힌다:
#     1장 넓은 실내 + 네온 사인 (수평·건축)
#     2장 카운터 + 스테인드글라스 램프 (근접·따뜻)
#     3장 천장 제등 (올려다봄 · 앰버 광원)
CAROUSEL["car-3"] = page(
    "계영배 통대관 캐러셀 3/3 — CTA",
    CAR_CSS + """
.hero,.hero img{height:580px}
.band{height:500px;padding-top:36px}
.copy{margin-top:18px}
.meta{margin-top:22px}
""",
    f"""<div class="hero"><img src="data:image/jpeg;base64,{b64('car-3.jpg')}"></div>
<div class="band">
  <div class="kicker">Private Event</div>
  <div class="copy">예약은,<br>프로필 링크에서.</div>
  <!-- '삼성에폭시 옆문'은 유용하지만 한 줄이 너무 길어진다 → 캡션으로 -->
  <div class="meta">을지로27길 43 2층 &middot; {R["access"]}</div>
  <div class="foot rule">
    <div class="foot-l">{B["handle"]}</div>
    <div class="next">{OFFER}</div>
  </div>
</div>""")

for name, html in {**CARDS, **CAROUSEL}.items():
    p = ROOT / f"card-{name}.html"
    p.write_text(html, encoding="utf-8")
    print(f"{p.name:22s} {len(html)//1024:4d} KB")
