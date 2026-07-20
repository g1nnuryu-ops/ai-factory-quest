# THUMNAIL — 유튜브 썸네일 제작 규격

> **작성일** 2026-07-18 · 캔버스 1920×1080 · 컨셉: **굵은 카피 + 강조색 + 배경 제거한 인물 합성**
> 파이프라인은 옆 폴더 [`movie_poster/DESIGN.md`](../movie_poster/DESIGN.md)에서 이미 검증된 방식(HTML → headless Chrome → PNG)을 그대로 승계한다.

---

## 0. 목표와 제약

| 항목 | 내용 |
|---|---|
| **무엇** | 유튜브 썸네일 1장 (1920×1080, 16:9) |
| **성공 기준** | **모바일 피드 크기(≈320px)로 줄여도** 영상 주제가 한 눈에 읽힐 것 |
| **구성** | 굵직한 카피 + 핵심 키워드 1~3개에 강조색(빨강·노랑) + 배경 제거한 인물 합성 |
| **폰트** | Black Han Sans / Pretendard Black — **둘 다 웹폰트로 불러온다** (§1 참고) |
| 🔴 **반드시** | 카피는 **CSS 텍스트**로 얹는다. AI 이미지 모델로 한글을 생성하면 **반드시 깨진다** (이 저장소의 반복 경험칙) |
| 🔴 **반드시** | 굵은 외곽선에는 **`paint-order: stroke fill`**. 빠뜨리면 한글이 뭉개진다 — §4 참고, **이 문서에서 제일 중요한 한 줄** |
| 🔴 **금지** | 실존 인물 얼굴을 AI로 합성하지 말 것. 본인 사진이거나 AI로 새로 생성한 인물만 쓴다 |

### 플랫폼 제한 (유튜브 측, 변동 가능)

| 항목 | 값 |
|---|---|
| 파일 크기 | **2MB 이하** ← PNG로 뽑으면 초과하기 쉽다. §7에서 JPG 변환 |
| 포맷 | JPG · PNG · GIF |
| 최소 폭 | 640px (권장 1280×720, **1920×1080도 문제없음**) |

---

## 1. 이 환경에서 검증한 전제

작업 전에 실제로 확인했다. **추정이 아니라 실측값**이다.

| 확인 항목 | 결과 | 그래서 |
|---|---|---|
| Black Han Sans 로컬 설치 | ❌ 없음 | **웹폰트 필수** |
| Pretendard 로컬 설치 | ❌ 없음 | **웹폰트 필수** |
| 설치된 한글 폰트 | `Malgun Gothic`, `Noto Sans KR VF` 뿐 | 폴백은 **눈에 띄게 얇다** → 폴백되면 실패로 간주 |
| Google Fonts / jsDelivr 도달 | ✅ 둘 다 200 | CDN 링크 그대로 사용 가능 |
| headless Chrome 웹폰트 렌더 | ✅ 됨 (`--virtual-time-budget=10000` 필요) | 이 옵션 없으면 폰트 로드 전에 캡처됨 |
| `-webkit-text-stroke` 단독 | ❌ **한글 자소가 뭉개짐** | `paint-order` 필수 (§4) |
| fal `birefnet` 배경제거 | ✅ 엣지 깨끗 | **채택** |
| fal `imageutils/rembg` | ⚠️ **밝은 헤일로 잔상** | 채도 높은 배경에서 티남 → 미채택 |
| `FAL_KEY` | ✅ `../movie_poster/.env` (gitignore 확인됨) | 그대로 재사용 |
| Python `rembg` | ❌ 미설치 (Pillow 12.2.0은 있음) | 로컬 배경제거 대신 fal API 사용 |

---

## 2. 캔버스와 세이프존

```
1920 × 1080 px  (16:9)
바깥 여백: 상하좌우 각 60px
작업 해상도: HTML 960×540 + deviceScaleFactor 2  →  출력 1920×1080
```

```
┌──────────────────────────────────────────────┐  y=0
│  ← 60px 여백                                  │
│   ┌────────────────────────────────────────┐ │
│   │                                        │ │
│   │            안전 영역                     │ │
│   │      (중요한 건 전부 이 안에)              │ │
│   │                                        │ │
│   │                          ┌───────────┐ │ │
│   └──────────────────────────│  ⛔ 뱃지   │─┘ │
│                              │  12:34    │   │
└──────────────────────────────┴───────────┴───┘  y=1080
                                 우하단 ~340×90px
```

🔴 **우하단은 비운다.** 유튜브가 **재생시간 뱃지**를 그 위에 덮는다. 얼굴·핵심 키워드를 여기 두면 가려진다.

### 축소 생존 계산

모바일 피드에서 썸네일은 **약 320px 폭**으로 표시된다 → **1920px 기준 1/6 축소.**

| 디자인상 글자 크기 | 모바일 실제 | 판정 |
|---|---|---|
| 260px | 43px | 아주 잘 읽힘 |
| **180px** | **30px** | ✅ **메인 카피 권장 하한** |
| 120px | 20px | 서브 카피 한계 |
| 60px | 10px | ❌ 안 읽힘. 쓰지 말 것 |

---

## 3. 레이아웃

### ✅ 기본안 — 좌 카피 / 우 인물 (7:5 분할)

가장 검증된 구도다. 시선이 **왼쪽 글자 → 오른쪽 인물** 순으로 흐르고, 인물의 시선·손짓이 카피를 되가리킨다.

```
┌───────────────────────────────────────────────┐
│                                               │
│   월급쟁이가                        ╭─────╮    │  ← 인물: 배경 제거 컷아웃
│                                    │ 인물 │    │    오른쪽 가장자리에 붙이고
│   ██3억██ 모은                      │ 상반신│    │    아래는 프레임 밖으로 흘림
│   ↑강조                             │     │    │
│   방법                              ╰─────╯    │
│                                               │
│   ─────────                          ⛔ 뱃지   │
└───────────────────────────────────────────────┘
     카피 존 ~55%              인물 존 ~45%
```

**규칙**
- 인물은 **오른쪽 가장자리에 붙인다.** 가운데 띄우면 붕 뜬다
- 인물 하단은 **프레임 밖으로 잘리게** — 잘려야 화면이 꽉 차 보인다
- 카피 3줄 이내. 왼쪽 정렬
- 인물이 손으로 가리키거나 보는 방향 = **카피 쪽**

### 대안 B — 인물 좌 / 카피 우

인물 사진이 **왼쪽을 보고 있을 때** 좌우를 뒤집는다. 시선이 프레임 밖을 향하면 이탈감이 생긴다.

### 대안 C — 인물 중앙 + 상하 카피

인물 표정이 압도적으로 좋을 때만. 카피가 좌우로 갈라져 약해지므로 **키워드 1개**로 줄인다.

---

## 4. 타이포 — 이 문서의 핵심

### 폰트 선택

| 용도 | 폰트 | 왜 |
|---|---|---|
| **메인 카피** | **`Black Han Sans`** | 압축형이라 **같은 폭에 글자가 더 들어간다.** 획이 두껍고 각져 썸네일 표준 얼굴 |
| 메인 카피 (대안) | `Pretendard` 900 | 더 넓고 현대적·정보성. 글자 수가 적을 때 유리 |
| 서브 카피 | `Pretendard` 700~800 | 메인보다 확실히 가볍게 |
| 숫자·영문 강조 | `Black Han Sans` | 숫자가 특히 단단하게 빠진다 |

⚠️ **Black Han Sans는 웨이트가 하나뿐이다.** `font-weight`를 줘도 안 변한다. 굵기 차이는 **크기와 색으로** 만든다.

```html
<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" rel="stylesheet">
```

### 🔴 외곽선 — 반드시 `paint-order: stroke fill`

썸네일 글자는 사진 위에 얹히므로 **두꺼운 외곽선이 필수**다. 그런데 `-webkit-text-stroke`는 **선을 글자 안쪽으로 그린다.** 한글은 자소가 빽빽하고 속공간이 좁아서, 두껍게 주면 **속이 메워져 글자가 사라진다.**

실제로 렌더해서 확인한 결과다 (`font-size:96px`, `stroke:14px`):

```
A  paint-order 없음  →  "획먹힘"이 검은 덩어리로 뭉개짐. 판독 불가
                        (영문 A와 숫자 300은 멀쩡해서 눈치채기 어렵다 ⚠️)
B  paint-order 있음  →  "정상" 깨끗하게 렌더
```

**영문·숫자로만 테스트하면 이 버그를 못 잡는다.** 반드시 한글로 확인할 것.

```css
.copy {
  font-family: 'Black Han Sans', sans-serif;
  font-size: 200px;
  line-height: 1.05;
  letter-spacing: -0.02em;        /* 굵은 글자는 살짝 좁혀야 덩어리로 읽힌다 */
  color: #FFFFFF;
  -webkit-text-stroke: 14px #0B0E14;
  paint-order: stroke fill;        /* ← 이거 없으면 한글 뭉개짐 */
  word-break: keep-all;            /* 한국어 단어 중간 줄바꿈 방지 */
  text-shadow: 0 10px 30px rgba(0,0,0,.55);   /* 배경에서 띄우는 그림자 */
}
```

### 크기 규격 (1920×1080 기준)

| 요소 | 크기 | 글자 수 |
|---|---|---|
| 메인 카피 | **180~260px** | 줄당 **4~7자**, 총 **9자 이내** |
| 서브 카피 | 90~120px | 14자 이내 |
| 꼬리표·채널명 | 46~60px | 최소한으로 |

**글자 수가 규격을 넘으면 폰트를 줄이지 말고 카피를 줄인다.** 썸네일이 실패하는 1순위 원인은 글자가 많은 것이다.

---

## 5. 색 — 강조색 운용

| 역할 | HEX | 용도 |
|---|---|---|
| 배경 딥 | `#0B0E14` | 순흑보다 살짝 푸른 검정. 외곽선 색도 이걸로 |
| 기본 텍스트 | `#FFFFFF` | 카피의 대부분 |
| **강조 노랑** | **`#FFE100`** | **글자색으로** 직접 쓴다. 검정 외곽선과 대비 최대 |
| **강조 빨강** | **`#E60012`** | **글자 뒤 형광펜 블록**으로 쓴다 (아래 참고) |
| 서브 텍스트 | `#C7CDD6` | 부연 설명 |

### 🔴 빨강과 노랑은 쓰는 법이 다르다

- **노랑 = 글자색.** 검정 외곽선 위에서 가장 강하게 튄다
- **빨강 = 배경 블록.** 빨강을 글자색으로 쓰면 **검은 배경에서 대비가 낮아 모바일에서 죽는다.** 대신 빨강 블록을 깔고 그 위에 **흰 글자**를 얹는다

```css
.hl-yellow { color: #FFE100; }                              /* 글자색 */
.hl-red    { background: #E60012; color: #fff;              /* 형광펜 블록 */
             padding: 0 .12em; border-radius: 6px; }
```

**규칙**
- 강조는 **키워드 1~3개까지.** 다 강조하면 아무것도 강조되지 않는다
- **빨강과 노랑을 맞붙이지 않는다.** 채도가 비슷해 경계가 진동한다. 붙일 거면 사이에 흰색이나 검정을 끼운다
- 강조색 총 면적은 **화면의 15% 이하**

---

## 6. 인물 소재 — 배경 제거 후 합성

### 배경 제거: `fal-ai/birefnet` 채택

두 모델을 실제로 돌려 **빨강·노랑 배경 위에 합성해서** 비교했다. 컷아웃 품질은 알파 통계가 아니라 **채도 높은 배경 위에서** 드러난다.

| 모델 | 결과 | 판정 |
|---|---|---|
| `fal-ai/imageutils/rembg` | 머리카락·어깨 둘레에 **밝은 헤일로**가 남아 빨강/노랑 위에서 티가 남 | ❌ |
| **`fal-ai/birefnet`** | 헤일로 없음. 잔머리도 살아있음 | ✅ **채택** |

> 반투명 픽셀 비율은 rembg가 더 높았지만(2.11% vs 0.81%) 그건 **부드러운 엣지가 아니라 헤일로**였다. 숫자만 보면 반대로 판단하게 된다.

```js
// 배경 제거 — ../movie_poster/regen-03.mjs 의 fal 호출 패턴 그대로
import { readFile, writeFile } from "node:fs/promises";
const FAL_KEY = (await readFile("../movie_poster/.env", "utf8")).match(/FAL_KEY=(.+)/)[1].trim();

const res = await fetch("https://fal.run/fal-ai/birefnet", {
  method: "POST",
  headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ image_url: SOURCE_URL }),   // 공개 URL 또는 data: URI
});
const out = await res.json();
const bin = Buffer.from(await (await fetch(out.image.url)).arrayBuffer());
await writeFile("person-cutout.png", bin);           // RGBA 투명 PNG
```

### 인물 소재를 새로 생성할 경우

**배경이 평평할수록 컷아웃이 깨끗하다.** 생성 프롬프트에 넣을 것:

```
upper body, plain flat seamless studio backdrop, bright even studio lighting,
sharp focus, exaggerated expression (shocked / pointing at camera)
```

- **과장된 표정**이 썸네일에서는 정답이다. 무표정은 클릭되지 않는다
- 카메라를 **가리키는 손동작**은 시선을 잡는다
- 배경이 복잡하거나 인물과 색이 비슷하면 어떤 모델도 깨끗하게 못 딴다

### 합성해서 '붙인 티' 안 나게 하기

컷아웃을 그냥 얹으면 스티커처럼 뜬다. 셋 중 최소 둘은 적용한다.

| 처리 | CSS |
|---|---|
| **바닥 그림자** — 배경에 앉힌다 | `filter: drop-shadow(0 24px 40px rgba(0,0,0,.6))` |
| **외곽 스트로크** — 배경에서 분리 | `drop-shadow`를 흰색으로 4방향 중첩하거나, 컷아웃 뒤에 확대 복제본을 흰색 실루엣으로 깔기 |
| **톤 맞추기** — 배경 색조와 통일 | `filter: saturate(1.05) contrast(1.05)` |

```css
.person {
  filter: drop-shadow(0 24px 40px rgba(0,0,0,.6))
          drop-shadow(0 0 0 #fff);      /* 흰 테두리가 필요하면 중첩 */
}
```

---

## 7. 제작 파이프라인

이 저장소에서 **이미 검증된 방식**을 쓴다. 새 도구를 도입하지 않는다.

```
thumbnail.html  (960 × 540, 인라인 CSS, 컷아웃 PNG는 base64 data URI로 삽입)
     │
     ├─ 웹폰트: Black Han Sans + Pretendard (CDN)
     ├─ 카피는 실제 CSS 텍스트 (+ paint-order: stroke fill)
     ├─ 인물은 <img> 투명 PNG
     │
     ▼
headless Chrome --screenshot --window-size=960,540 --force-device-scale-factor=2
     │                       --virtual-time-budget=10000
     ▼
thumbnail.png  (1920 × 1080)
     │
     ▼  2MB 넘으면
thumbnail.jpg  (quality 90)
```

```powershell
# PowerShell에서 실행할 것 (Bash로 하면 경로가 깨진다)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --headless=new --disable-gpu --hide-scrollbars `
  --screenshot="$PWD\thumbnail.png" `
  --window-size=960,540 --force-device-scale-factor=2 `
  --virtual-time-budget=10000 `
  --user-data-dir="$env:TEMP\cp-thumb-01" `
  "$PWD\thumbnail.html"
```

**주의 (전부 이번에 직접 겪은 것)**

- 🔴 **`--user-data-dir`은 호출마다 새 이름**으로 줄 것. 재사용하면 **아무 오류 메시지 없이 PNG가 안 만들어진다**
- 🔴 **`--virtual-time-budget=10000` 없으면** 웹폰트 로드 전에 캡처되어 **맑은 고딕으로 폴백**된다. 조용히 실패하므로 결과물을 눈으로 봐야 안다
- PowerShell에서 chrome 실행 시 `NativeCommandError`가 떠도 **파일은 정상 생성**된다. stderr를 에러로 오해하지 말 것
- 이미지는 **base64 data URI**로 넣어야 `file://`에서 안전하다
- 큰 base64를 인라인할 때는 스크립트 밖으로 뺄 것

**2MB 초과 시 JPG 변환:**

```bash
py -c "from PIL import Image; im=Image.open('thumbnail.png').convert('RGB'); im.save('thumbnail.jpg', quality=90, optimize=True)"
```

---

## 8. 체크리스트

작업 끝나고 이것부터 확인한다.

**치명적 (하나라도 걸리면 다시)**
- [ ] **320px로 축소**해서 메인 카피가 읽히는가 ← 제일 중요한 테스트
- [ ] 한글이 **뭉개지지 않았는가** (`paint-order: stroke fill` 적용 확인)
- [ ] 폰트가 **Black Han Sans / Pretendard로 렌더**됐는가 (맑은 고딕 폴백 아닌가)
- [ ] 카피가 **CSS 텍스트**인가 (AI 생성 이미지가 아닌가)

**규격**
- [ ] 1920×1080으로 나왔는가
- [ ] 파일 크기 **2MB 이하**인가
- [ ] **우하단 재생시간 뱃지 영역**이 비어 있는가
- [ ] 바깥 여백 60px가 지켜졌는가

**디자인**
- [ ] 강조 키워드가 **3개 이하**인가
- [ ] 빨강을 **글자색으로 쓰지 않았는가** (블록 배경으로 썼는가)
- [ ] 빨강과 노랑이 **직접 맞닿아 있지 않은가**
- [ ] 인물 컷아웃에 **헤일로**가 없는가 (강조색 위에서 확인)
- [ ] 인물에 **그림자**가 있는가 (스티커처럼 떠 있지 않은가)
- [ ] 인물의 **시선·손짓이 카피 쪽**을 향하는가
- [ ] 메인 카피가 **9자 이내**인가

**축소 테스트 명령:**
```bash
py -c "from PIL import Image; Image.open('thumbnail.png').resize((320,180)).save('check-320.png')"
```

---

## 다음 단계

1. 영상 주제와 카피 문구를 정한다 (메인 9자 이내 + 강조 키워드 1~3개)
2. 인물 사진을 준비한다 — 본인 사진 또는 AI 생성 (§6 프롬프트)
3. `birefnet`으로 배경 제거 → `person-cutout.png`
4. `thumbnail.html` 작성 → 위 파이프라인으로 렌더
5. §8 체크리스트, 특히 **320px 축소 테스트**

카피 문구와 인물 소재가 정해지면 `thumbnail.html`부터 만들면 됩니다.
