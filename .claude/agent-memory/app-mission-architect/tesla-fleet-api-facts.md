---
name: tesla-fleet-api-facts
description: Tesla Fleet API 사실관계 — 내비 목적지 전송(navigation_request)은 virtual key 서명이 필요 없는 REST 예외. 한국 리전·과금·기존 경쟁앱 포함
metadata:
  type: reference
---

2026-07-14 라이브 검증. `developer.tesla.com` 은 **WebFetch 403(봇 차단)** 이므로 공식 문서 대신 **Tesla 공식 소스코드 + 커뮤니티**로 우회 검증했다.

## 핵심 — 내비 명령은 서명(virtual key)이 필요 없다

`github.com/teslamotors/vehicle-command` 의 `pkg/proxy/command.go` 에는 74개 명령이 있고, 그중 **`ErrCommandUseRESTAPI`(= 서명하지 말고 REST로 보내라)를 반환하는 명령은 단 4개**다:

- `set_managed_charge_current_request`
- `set_managed_charger_location`
- `set_managed_scheduled_charging_time`
- **`navigation_request`** ← 목적지 전송

**Why 중요:** 2021년 이후 차량은 도어락·공조 등 나머지 70개 명령에 **서명(차주가 테슬라 앱에서 virtual key 페어링)** 이 필수다. 이 페어링이 서드파티 테슬라 앱의 최대 진입장벽인데, **내비 목적지 전송만은 예외**다. 보안 명령이 아니라 인포테인먼트 채널(모바일 앱 '공유'와 같은 경로)이기 때문. → **tesla-http-proxy 불필요, virtual key 페어링 불필요.**

## 전송 방법

```
POST {base}/api/1/vehicles/{vehicle_tag}/command/navigation_request
Authorization: Bearer <third-party token>
{"type":"share_ext_content_raw","locale":"ko-KR","timestamp_ms":"...",
 "value":{"android.intent.extra.TEXT":"<주소 | 좌표 | maps.google.com URL>"}}
```
- 구버전 Owner API와 문법이 동일하다.
- **좌표를 받아들인다** — 구글맵 앱이 실제로 주소가 아니라 좌표를 보낸다. 차가 좌표로 자체 경로계산.

## 그래도 필요한 셋업 (내비만 써도 필수)

developer.tesla.com 앱 등록 → **도메인 필요** → `https://<도메인>/.well-known/appspecific/com.tesla.3p.public-key.pem` (secp256r1 EC 공개키) 호스팅 → `POST /api/1/partner_accounts` 등록 → 차주 OAuth.

**무료 서브도메인이 통과되는가:** 확증 없음(2026-07 조사). `*.github.io`/`*.vercel.app`/`*.pages.dev` 성공 사례를 못 찾았고, **금지 정책도 없다.** 확인된 실사용은 Cloudflare Pages·개인 도메인·DuckDNS. → **무료로 10분 시도해 보고 거부되면 도메인 구매(연 1~2만원).** 첫날에 판정된다.
⚠️ **GitHub Pages는 `.nojekyll` 파일이 없으면 `.well-known` 폴더가 배포에서 통째로 누락된다** (Jekyll이 점으로 시작하는 폴더를 무시).

## 리전 / 과금

- **한국 = APAC → `https://fleet-api.prd.na.vn.cloud.tesla.com`** (EU 아님. 잘못 쓰면 **412**)
- pay-per-use지만 **계정당 월 $10 크레딧 무료** — "차 2대 + 하루 100명령 + 스트리밍" 수준을 커버. 개인 프로젝트는 사실상 무료.

## 한국 테슬라 내비의 실제 약점 (문제 정의 근거)

- 지도 데이터는 T맵을 쓰지만 **T맵의 검색·경로엔진과는 미연동.** 과속단속·차선정보 없음.
- **대형시설 정문/후문 구분을 못 한다** (공항·대공원 등).
- 그래서 오너들이 네이버지도/카카오맵/티맵에서 검색 → **테슬라 앱으로 '공유'** 하는 우회로를 쓴다.

## ⚠️ 기존 경쟁 앱이 이미 있다

"내 테슬라에 목적지 전송", "Navi To Tesla" 등 **티맵/네이버/카카오 목적지를 테슬라로 전송하는 앱이 이미 존재**한다.
→ **단순 전송 앱을 또 만드는 건 복제다.** 차별점은 반드시 AI(목적지를 *정해주는* 역할)여야 한다. 기존 앱은 전부 "사용자가 이미 목적지를 검색·선택한 뒤" 동작한다.

관련: [[check-existing-before-scoping]]
