# 유튜브 썸네일 A/B — 〈인재전쟁2〉 3부 최태원의 대답

> **작성일** 2026-07-18 · 규격·근거는 [`thumnail.md`](./thumnail.md)
> 대상 영상: [KBS 다큐 인사이트 — 최태원의 대답](https://www.youtube.com/watch?v=sy4Z15wIxcA) (47분 · 조회 51만 · 2026-05-29)

---

## ⚠️ 이건 연습용 재디자인입니다

- 인물 사진은 **SK 공식 뉴스룸의 보도사진**이고 **SK의 저작물**입니다. 학습·습작 용도로만 썼습니다.
- 최태원 회장은 실존 인물이라 **얼굴을 AI로 생성하지 않았습니다.** 실제 사진의 배경만 제거해 합성했습니다 ([`thumnail.md`](./thumnail.md) §0 금지 항목).
- 실제 채널에 올릴 목적이라면 **사진 사용 허가를 별도로 받아야** 합니다.

---

## 산출물

| 파일 | 컨셉 | 크기 |
|---|---|---|
| [`out/thumb-a.png`](./out/thumb-a.png) | **A — 인물 합성.** 최 회장 컷아웃 + "전문직이 사라진다" | 1.39MB |
| [`out/thumb-b.png`](./out/thumb-b.png) | **B — 타이포.** "공대에 미친 중국 VS 의대에 미친 한국" | 0.61MB |
| [`out/_check-320.png`](./out/_check-320.png) | 두 안의 **320px 축소 판독 테스트** 결과 | — |

둘 다 1920×1080, 유튜브 2MB 제한 통과.

---

## A/B가 실제로 테스트하는 것

**같은 영상을 파는 두 가지 다른 약속**이라 A/B로 의미가 있습니다.

| | A — 인물 | B — 타이포 |
|---|---|---|
| 후킹 | **누가** 말하는가 (최태원의 권위) | **무엇을** 말하는가 (도발적 대비) |
| 카피 | 전문직이 사라진다 | 공대에 미친 중국 VS 의대에 미친 한국 |
| 강조색 | 노랑 글자(전문직) + 빨강 킥커 | 빨강 블록(중국) + 노랑 블록(한국) |
| 정렬 | 좌측 정렬 | 중앙 정렬 |
| 유리한 상황 | 최 회장을 아는 시청자 | 이슈 자체에 반응하는 시청자 |

### 카피 출처

- **A** — 설명문의 "AI가 전문직을 대체하는 이 시대"를 썸네일 어법으로 압축한 것입니다. 원문보다 **한 단계 센 표현**이니 톤을 낮추려면 `thumb-a.html`의 `.main`을 "AI가 / 전문직을 / 대체한다"로 바꾸면 됩니다.
- **B** — 설명문 **첫 줄을 거의 그대로** 씁니다("공대에 미친 중국과 의대에 미친 한국"). 제작진이 직접 뽑은 후킹 문구라 가장 안전하면서 세다고 판단했습니다.

### 공식 썸네일과의 차별화

공식 썸네일은 **이미 인물 우측 + 카피 좌하단 + 노랑 강조** 구도라, 같은 레이아웃을 반복하면 재디자인이 아니라 모작이 됩니다. 그래서:

- **A**는 같은 계열이되 **카피를 주장문으로** 바꿨습니다(공식은 '3부 최태원의 대답'이라는 정보 표기).
- **B**는 인물을 아예 빼고 **중앙 대칭 타이포**로 갔습니다 — 공식과 겹치는 지점이 없습니다.

---

## 소재

| 파일 | 출처 |
|---|---|
| `source/chey-1744-original.jpg` | SK 뉴스룸 [idx=1744](https://www.sk.com/ko/media/news_view.jsp?pageNo=1&idx=1744) "운영개선(O/I)과 본업 지식 쌓아야 AI 선점" (800×553) |
| `source/chey-1743-original.jpg` | SK 뉴스룸 idx=1743 — 팔 벌린 포즈. **미채택**(우측 슬롯에 넣기엔 가로로 너무 넓음) |
| `source/chey-1744-upscaled.png` | `fal-ai/esrgan` 2× → 1600×1106 |
| `source/chey-cutout.png` | `fal-ai/birefnet` 배경 제거 (RGBA) |
| `source/chey-trim.png` | 알파 여백 제거 → **1135×1090**, 실제 합성에 사용 |
| `source/check-cutout.png` | 컷아웃을 빨강·노랑 위에 올려 **헤일로 검사**한 결과 |

**후보 8장 중 1744를 고른 이유:** 얼굴이 가장 크고(썸네일은 얼굴 크기가 곧 판독성), 마이크를 든 자세가 다큐 인터뷰 톤과 맞고, 세로 구도라 우측 슬롯에 그대로 들어갑니다. 무대 전경 샷(1763·1751 등)은 인물이 너무 작아 탈락했습니다.

---

## 재현

```powershell
# 반드시 개별 실행. foreach로 연달아 돌리면 렌더가 조용히 실패합니다 (아래 참고)
$d = "C:\Users\rgw\Desktop\AI 공장\quest\week_7\goblin\youtube_thumnail"
$uri = ([System.Uri]"$d\thumb-a.html").AbsoluteUri
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --headless=new --disable-gpu --hide-scrollbars `
  --screenshot="$d\out\thumb-a.png" --window-size=1920,1080 `
  --virtual-time-budget=15000 --user-data-dir="$env:TEMP\cp-thumbA-1" `
  --allow-file-access-from-files $uri
```

인물 소재를 다시 만들려면 `scratchpad/cutout.mjs` 방식(업스케일 → birefnet). `FAL_KEY`는 `../movie_poster/.env`.

### 이번에 실제로 겪은 것

- **`--user-data-dir`을 재사용하거나 두 렌더를 연속 실행하면** PNG가 **아무 에러 없이** 안 만들어집니다. 호출마다 새 이름 + 개별 실행.
- `paint-order: stroke fill`은 두 시안 모두에 들어가 있습니다. 빼면 굵은 외곽선이 한글 자소를 메웁니다.
- PowerShell에서 chrome 실행 시 뜨는 `NativeCommandError`는 **정상**입니다(Chrome이 성공 메시지를 stderr로 냄). `Test-Path`로 확인하세요.

---

## QA 결과

`out/_check-320.png` — 모바일 피드 실제 표시폭(320px)으로 줄여 확인했습니다.

- ✅ 두 안 모두 메인 카피 판독 가능
- ✅ **B안의 '공대' vs '의대' 구분이 축소 후에도 살아있음** — 이 카피의 성패가 걸린 지점이라 별도로 확인했습니다
- ✅ 한글 뭉개짐 없음 / 폰트 폴백 없음(Black Han Sans·Pretendard 정상)
- ✅ 2MB 이하 / 우하단 재생시간 뱃지 영역에 핵심 요소 없음
- ⚠️ A안 킥커는 처음 33px로 잡았다가 축소 시 뭉개져 **44px로 키웠습니다**
