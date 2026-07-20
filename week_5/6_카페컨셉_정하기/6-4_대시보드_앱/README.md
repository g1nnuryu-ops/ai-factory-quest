# ☕ 놀담(Noldam) 카페 사장님 대시보드

파주 근교 **키즈 브런치 카페 '놀담'** 사장님을 위한 통합 운영 대시보드.
로그인 후 **하나의 화면**에서 오늘의 카페 상황을 한눈에 파악한다.

> 슬로건 — *"아이는 놀고, 어른은 쉬고."*

![대시보드](./앱%20스크린샷_3_대시보드_전체.png)

## 기능 (요구사항 매핑)
1. **로그인/회원가입** — 이메일 + 비밀번호, **JWT** 인증 (bcrypt 해시, 7일 토큰).
2. **카페 운영 데이터 DB 연동** — 매출·메뉴판매·재고·발주 데이터를 Supabase(PostgreSQL)에서 조회. KPI 카드 + 매출추이 차트 + 인기메뉴 + 재고현황.
3. **노션 할일/발주 메모 연동 (노션이 원본)** — 할일/발주 메모의 원본이 노션 DB. 대시보드 CRUD 가 노션 REST 로 직접 읽고 써서 항상 노션과 일치, "노션에서 열기" 버튼. + **파주 날씨 API**(OpenWeatherMap)로 **손님 수 예측**.
4. **AI 오늘의 브리핑** — 매출·예측·재고·할일을 종합해 OpenAI(gpt-4o-mini)가 아침 브리핑 생성.
5. **단일 대시보드** — 위 모든 것을 스크롤 한 페이지에 표시.

## 아키텍처
- `server.js` — Express + PostgreSQL(`pg`) + JWT. 모든 API + 정적 서빙 + SPA fallback.
- `index.html` — 단일 파일 CDN React 18 (Babel Standalone **@7.26.4 고정**), Tailwind, Chart.js. 빌드 도구 없음.
- 응답 규약: `{ success, data }` / `{ success, message }`. 인증 필요 API 는 `Authorization: Bearer <token>`.

### 데이터 (Supabase 공유, `cafe_` 접두사)
- 읽기 전용(이미 시드됨, `../seed_cafe_db.js`): `cafe_menu`, `cafe_daily_sales`, `cafe_menu_sales`, `cafe_inventory`, `cafe_purchase_orders` (2026-01-01 ~ 2026-07-02).
- 서버가 생성: `users`(인증 공용). 할일/발주 메모는 **노션 DB 가 원본**(`NOTION_TOKEN` 설정 시); 토큰이 없을 때만 `cafe_todos` 폴백 테이블을 만들고 1회 시드.

## 환경변수
- 로컬 `.env` (gitignore): `JWT_SECRET`, `PORT`(=3006), `NOTION_MEMO_URL`, `NOTION_TOKEN`(노션 원본 연동; 없으면 DB 폴백)
- 공유 `../../.env` (week_5 루트): `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OpenWeatherMap_api_key`
  - ⚠️ 이 앱은 week_5 아래 **2단계** 폴더라 공유 .env 는 `../../.env`. server.js 는 `.env → ../.env → ../../.env` 순으로 로드(로컬 우선).

## 실행
```bash
npm install
npm start          # http://localhost:3006
```

## 배포 (Vercel)
- **라이브:** <https://noldam-cafe-dashboard.vercel.app>
- 서버리스: `server.js` 가 `module.exports = app`(로컬만 `app.listen`). `vercel.json` 이 모든 경로를 `server.js` 로 라우팅하고 `index.html` 을 함께 포함(`includeFiles`).
- **환경변수(Production 등록 필수):** `DATABASE_URL`, `JWT_SECRET`, `NOTION_TOKEN`, `NOTION_MEMO_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OpenWeatherMap_api_key`. 로컬 `.env`(`../.env` 체인 포함)는 배포되지 않으므로 Vercel 프로젝트 env 에 직접 넣는다. `.vercelignore` 로 `.env`·스크린샷 제외.
- 재배포: 이 폴더에서 `vercel --prod` (프로젝트: `noldam-cafe-dashboard`).
- 검증(prod 스모크): 회원가입/JWT, **노션 원본 9건 로드**, DB 요약(재고부족 4건), AI 브리핑(gpt-4o-mini) 모두 정상.

## 참고
- **날씨 API**: OpenWeatherMap **2.5 current** 사용(One Call 3.0 은 별도 유료 구독 필요). 새로 발급한 키는 활성화까지 최대 1~2시간 `401` 이 날 수 있는데, 이 경우 날씨 패널은 "활성화 대기중"으로 표시되고 **손님 예측은 DB 요일평균 기반으로 정상 동작**한다(키 활성화 시 자동 반영).
- **손님 수 예측** = 과거 같은 요일 평균 방문객(baseline) × 날씨 가중치(비/흐림/폭염 등).
- **AI 브리핑**은 서버 날짜 기준 메모리 캐시(재과금 방지), "새로고침"으로 강제 재생성. OpenAI 실패 시 같은 숫자로 결정적 폴백 브리핑 표시.
- **노션 메모 DB**: <https://app.notion.com/p/54ecd00e904847c0a5526c3b1d35ced7> (대시보드 "노션에서 열기"와 연결).

## 노션 ↔ 대시보드 동기화 — ✅ 완료 (2026-07-04)
> **노션을 단일 원본(source of truth)으로** 채택. 대시보드 할일/발주 메모는 노션 DB `놀담 카페 · 할일 & 발주 메모`를 직접 읽고 쓴다(저장소가 하나라 항상 일치).

- `server.js`의 todos 4개 엔드포인트(GET/POST/PATCH/DELETE)를 노션 REST(`2022-06-28`) 직접 연동으로 교체. 속성 매핑: `메모`=title, `구분`=select(할일/발주), `완료`=checkbox, `등록일`=created_time(자동). 삭제는 노션 페이지 **archive**.
- id 는 노션 page UUID(문자열). 프런트는 id 를 React key/URL 로만 써서 무수정.
- `NOTION_TOKEN` 이 없으면 기존 Postgres(`cafe_todos`)로 자동 폴백 → 토큰 없이도 앱 동작. AI 브리핑은 노션 일시장애 시 빈 메모로 폴백.
- **선행조건(1회):** 노션에서 내부 통합(`GEONWOO RYU`)을 위 DB 의 `···` → Connections 에 연결해야 API 가 DB 를 본다. 미연결 시 목록 호출이 안내 메시지와 함께 502.
- **Vercel 배포 시:** 프로젝트 env 에도 `NOTION_TOKEN` 을 추가해야 프로덕션에서 노션 원본 연동이 동작(없으면 DB 폴백).
- 검증: 앱 API E2E 15/15 통과(추가·완료토글·내용수정·삭제가 노션에 실제 반영), 브라우저 UI 추가까지 노션 왕복 확인 → `앱 스크린샷_4_노션원본연동.png`.

## 이어서 실행하려면
```bash
cd "quest/week_5/6_카페컨셉_정하기/6-4_대시보드_앱"
npm start        # http://localhost:3006  (deps·DB·노션DB·화면 모두 검증 완료 상태)
```
로그인은 회원가입으로 새 계정을 만들거나, 세션에서 만든 테스트 계정을 사용(비밀번호는 채팅 기록 참고 — 레포에는 미기록).
