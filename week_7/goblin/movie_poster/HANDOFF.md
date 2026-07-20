# HANDOFF (A안) — 2026-07-14 밤 중단 시점

> ## ⛔ 먼저 읽으세요 — 이 문서는 **두 갈래 중 A안**입니다
>
> 이 폴더에는 **완성된 포스터가 두 개** 있습니다. 이 문서(A안)를 그대로 따라가면
> **공식 스틸 원본 + 실제 배우 얼굴**로 만든 포스터 작업을 이어가게 됩니다.
>
> | | **A안** (이 문서) | **B안** → [`HANDOFF-AI-GENERATED.md`](./HANDOFF-AI-GENERATED.md) |
> |---|---|---|
> | 결과물 | `poster-real-stills.png` | **`poster.png`** ✅ |
> | 소재 | 🔴 공식 스틸 원본 (`source/`) | ✅ fal.ai 신규 생성 (`generated/`) |
> | 인물 | 🔴 실제 배우 얼굴 (현빈·정우성·우도환) | ✅ 얼굴 없음 (실루엣·뒷모습) |
>
> **B안을 권합니다.** 공식 스틸은 저작권 자료이고 실존 배우의 얼굴이 주피사체입니다.
> 이 문서 스스로도 **§3-C**에서 "AI로 배우 얼굴을 재현하는 건 identity bleed로 불가능하고,
> 실제 얼굴이 필요하면 공식 스틸을 그대로 써야 한다"고 결론냅니다 —
> 즉 **A안의 종착지는 '공식 스틸을 그대로 합성한 포스터'** 입니다.
>
> A안 산출물(`poster-real*`, `poster-gpt-image-2.png`)은 **커밋에서 제외**했습니다(`.gitignore`).
> 개인 습작으로만 두고, 공개·제출·배포는 **B안 `poster.png`** 로 하세요.
>
> ---

> 내일 이 파일만 읽고 바로 이어서 작업하면 됩니다.
> **결론부터: `poster-real-stills.png` 는 거의 완성됐고, `poster-gpt-image-2.png` 는 지금 깨져 있습니다.**

---

## 1. 지금 당장의 상태 — ✅ 두 버그 모두 해결 (2026-07-15)

| 산출물 | 상태 | 비고 |
|---|---|---|
| **`poster-real-stills.png`** (2000×3000) | 🟢 **완성** | 진짜 배우 얼굴 + 제목 + 빌링 블록. 상단 "유령 텍스트"는 **실제 결함이 아니었음**(§3-B) |
| **`poster-gpt-image-2.png`** (2000×3000) | 🟢 **복구 완료** | 배경 검정 버그 수정(§3-A). 5177 KB로 정상 렌더 |

> 두 파일 모두 `.gitignore` 대상(A안 개인 습작). 공개용은 여전히 B안 `poster.png`.

---

## 2. 재렌더 방법 (참고 — ①②③ 모두 완료됨 2026-07-15)

> ✅ 아래는 이미 실행해 두 버그를 잡았습니다. 소재/HTML을 또 바꿨을 때 **다시 렌더하는 방법**으로만 참고하세요.

### ① `poster-ai.html` 배경 버그 고치기 (5줄) — 완료

`poster-ai.html` 18번째 줄:

```css
/* 지금 (배경이 안 그려짐) */
.poster { ... background: var(--bg) url('ART_SRC') center/cover no-repeat; overflow: hidden }

/* 이렇게 바꾼다 — 단축 속성 대신 롱핸드로 분리 */
.poster { position: relative; width: 1000px; height: 1500px;
          background-color: #0A0B0D;
          background-image: url('ART_SRC');
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          overflow: hidden }
```

### ② 두 장 다시 렌더 (복붙용)

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# 실제 스틸 버전
& ".\movie_poster\render.ps1" -Html ".\movie_poster\poster-real.html" -Out ".\movie_poster\poster-real-stills.png" -Images @(
  ".\movie_poster\source\still-s2-01-baek-gitae-power-desk.jpg",
  ".\movie_poster\source\still-s2-03-baek-gihyun-general.jpg",
  ".\movie_poster\source\still-s2-02-jang-gunyoung-evidence-board.jpg"
)

# gpt-image-2 버전 (아트는 이미 생성돼 있음 — API 재호출 불필요)
& ".\movie_poster\render.ps1" -Html ".\movie_poster\poster-ai.html" -Out ".\movie_poster\poster-gpt-image-2.png" -Images @(".\movie_poster\out\poster-b-art.png")
```

### ③ 유령 텍스트 잡기 (§3-B)

---

## 3. 버그 2개 — 해결 기록

### ✅ A. `poster-ai.html` 배경이 안 그려지던 문제 — **해결**

- **증상**: 렌더 결과가 온통 검정. PNG 349KB(정상 5MB대).
- **원인**: `background:` **단축 속성 + `var(--bg)` + 3MB data URI** 조합을 headless Chrome이 배경 통째로 누락시킴.
- **수정**: `.poster` 배경을 **롱핸드로 분리** (`background-color` / `background-image` / `background-size` …). → 5177 KB로 정상 렌더 확인.

### ✅ B. "상단 유령 텍스트" — **실제 결함 아님 (뷰어 표시 아티팩트)**

- **증상으로 보였던 것**: 전체 이미지를 열면 맨 위에 빌링 꼬리 3줄이 흐릿하게 보임.
- **판정**: **파일 픽셀에는 없다.** 세 가지 실측이 모두 "상단 깨끗"으로 일치 —
  1. 상단 260행 행별 밝기 스캔 → 텍스트 스파이크 없이 **매끈한 그라데이션**(집무실 벽)뿐
  2. 상단 320px 크롭 → 텍스트 없음
  3. 상단 240px **밝기 4배 증폭** 크롭 → 텍스트 없음 (있었다면 확 드러남)
- **결론**: 세로로 긴 2000×3000 이미지를 **뷰어가 축소 표시할 때 하단 빌링이 상단에 되비치는 표시 현상**. 인쇄·업로드 결과물에는 영향 없음.
- **부수 조치**: 그래도 관행상 `grain` 레이어를 title-zone **뒤(맨 마지막)**로 옮겨 B안 `poster.html`과 구조를 맞춰둠. (해가 없고 더 안전)

> ⚠️ **교훈**: 세로로 긴 포스터는 **전체 Read의 상단 잔상**을 결함으로 오인하기 쉽다. 판정은 **픽셀 스캔 / 크롭 / 밝기 증폭**으로 할 것.

### 🔵 C. (버그 아님 — 구조적 한계) gpt-image-2 는 실제 배우 얼굴을 보존하지 못한다

- fal 의 `openai/gpt-image-2/edit` 스키마에 **`input_fidelity` 파라미터가 아예 없다** (OpenAPI 확인함).
- 프롬프트로 "얼굴을 정확히 복사하라"고 강하게 지시해도(`prompt-b.txt`) **세 얼굴이 서로 닮아버리는 identity bleed** 가 남는다.
- → **실제 배우 얼굴이 필요하면 `poster-real-stills.png` 계열로 가야 한다.** 이건 프롬프트로 못 고친다.

---

## 4. 파일 지도

```
movie_poster/
├── poster-real-stills.png   🟢 결과물 — 실제 스틸 합성 (2000×3000)
├── poster-gpt-image-2.png   🔴 결과물 — 지금 깨짐, 재렌더 필요
│
├── poster-real.html         실제 스틸 3분할 합성 템플릿  (IMG1/IMG2/IMG3 치환)
├── poster-ai.html           gpt-image-2 아트 + 타이틀 템플릿 (ART_SRC 치환) ← §3-A 수정 대상
├── _billing.html            타이틀·빌링 블록 공용 마크업 (참고용, 위 둘에 인라인돼 있음)
├── render.ps1               HTML → 2000×3000 PNG (headless Chrome). ⚠️ ASCII 전용 유지
│
├── make-poster.js           fal.ai gpt-image-2 호출기
├── prompt-a.txt             1차 프롬프트
├── prompt-b.txt             2차 — 얼굴 보존 강화판 (그래도 한계, §3-C)
├── out/
│   ├── poster-a-art.png     1차 AI 아트
│   └── poster-b-art.png     2차 AI 아트 ← poster-ai.html 이 쓰는 배경
│
├── source/     (21)  공식 스틸·포스터 — 소재
├── reference/  (14)  레퍼런스 포스터 — 우민호 4 + 해외 10
│
├── SERIES.md      작품 정보 (빌링 블록의 출처)
├── SOURCES.md     source/ 출처·저작권
├── REFERENCE.md   reference/ 출처 + 구도 분석
├── DESIGN.md      설계안
└── HANDOFF.md     ← 이 파일
```

> `generate.mjs` · `regen-01.mjs` · `generated/` 는 **별도로 지시하신 병행 작업본**입니다. 제 쪽에서 손대지 않았습니다.

---

## 5. 완성된 빌링 블록 (SERIES.md 기준, 이미 두 HTML에 들어가 있음)

```
        국가는 그의 사업이었다              ← 카피 (DESIGN.md A안)
           MADE IN KOREA
         메이드 인 코리아                   ← HYGothic-Extra, 금색 그라데이션
   ─────────────────────────────
현빈 · 정우성 · 우도환 · 조여정 · 서은수 · 원지안
연출 우민호 | 각본 박은교·박준석 | 제작 하이브미디어코프·젬스톤픽쳐스
시즌1 2025.12.24 Disney+ 단독 공개·6부작 ／ 시즌2 2026 하반기
   ──────
   FAN-MADE POSTER · NOT OFFICIAL
```

한글은 전부 **CSS 텍스트**다. AI 이미지로 만들면 반드시 깨진다 (DESIGN.md 원칙).

---

## 6. API 키

- `movie_poster/.env` 에 `FAL_KEY` 저장. **`.gitignore` 등록 + `git check-ignore` 로 검증 완료** → 커밋 안 됨.
- ⚠️ 이 키를 **채팅에 평문으로 붙여넣으셨습니다.** 대화 기록을 공유할 일이 있으면 fal 대시보드에서 **회전(rotate)** 하세요.
- gpt-image-2 호출은 지금까지 **2회** (prompt-a, prompt-b). 아트가 이미 있으므로 **내일 렌더는 API 재호출이 필요 없습니다.**

---

## 7. 커밋 (아직 안 했음)

병행 작업본이 섞여 있어 임의로 커밋하지 않았습니다. 원하시면:

```powershell
git add week_7/movie_poster
git commit -m "week_7 movie_poster: 메이드 인 코리아 팬메이드 포스터 — 스틸 21 + 레퍼런스 14 + 설계안 + 포스터 2종"
```

파일은 디스크에 그대로 있으니 노트북을 꺼도 사라지지 않습니다.
