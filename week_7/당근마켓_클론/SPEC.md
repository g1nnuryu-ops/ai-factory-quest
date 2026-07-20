# 당근마켓 클론 — 공유 명세 (API 계약서)

프론트(`index.html` + `client.js`)와 백엔드(`server.js`)를 **서로 다른 에이전트가 동시에** 만든다.
이 문서가 둘 사이의 유일한 계약이다. **여기 적힌 경로·필드명·타입에서 벗어나지 말 것.**
명세가 모호하면 임의로 바꾸지 말고, 이 문서의 규칙을 그대로 따른다.

---

## ★ 사용자 확정 요구사항 (2026-07-19 추가 — 최우선 순위)

아래는 사용자가 직접 못박은 **핵심 기능**이다. 다른 어떤 기능(채팅·후기·끌어올리기 등)보다 우선하며,
시간이 부족하면 다른 걸 줄이더라도 이건 완성도 있게 끝내야 한다.

**A. 상품 등록**
- 입력 필드: **이미지(최대 3장) + 제목 + 가격 + 설명 + 카테고리**
- **이미지는 최대 3장** — 기존 명세의 "5장"에서 변경됨. 서버 검증·프론트 UI 모두 **3장**으로 맞출 것.
- **본인만 수정/삭제 가능** — 서버는 `WHERE seller_id = 나` 로 SQL 레벨에서 소유권 강제(403),
  프론트는 남의 글에서 수정/삭제 버튼 자체를 숨긴다. **둘 다 해야 한다**(UI 숨김만으로는 보안이 아니다).

**B. 상품 목록**
- **최신순 정렬** + **카테고리 필터** + **키워드 검색**(제목·설명 대상, 대소문자 무시)
- 세 조건은 **동시에 적용**되어야 한다(예: "디지털기기" 필터 + "아이폰" 검색 + 최신순).

**C. 상품 상세**
- **이미지 슬라이드**(좌우 넘김 + 현재 위치 인디케이터), 상품 정보(제목·가격·카테고리·설명·조회수·등록시간),
  **작성자 정보**(닉네임·동네·매너온도), **관심(찜) 버튼**(토글 + 관심 수 표시)

---

## 0. 프로젝트 규칙

- 위치: `quest/week_7/당근마켓_클론/`
- 파일 구조(3-file 아키텍처): `server.js` / `index.html` / `client.js` (+ `package.json`, `README.md`)
- 빌드 도구 없음. 프론트는 CDN React + Tailwind, JSX 는 브라우저에서 Babel 로 변환.
- 서버 포트: **3007** (다른 quest 앱과 겹치면 브라우저가 이전 앱의 캐시 페이지를 띄운다)
- 환경변수:
  - `DATABASE_URL` — 상위 `quest/week_7/.env` (공용 Supabase Postgres)
  - `JWT_SECRET`, `PORT` — 앱 로컬 `.env`
  - server.js 는 **두 파일을 모두 로드**한다(로컬이 우선):
    ```js
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
    ```
- **공용 Supabase 를 다른 quest 앱과 공유**한다. 이 앱의 테이블은 모두 `carrot_` 접두사.
  기존 공용 `users` 테이블은 **건드리지 않는다**(이 앱은 `carrot_users` 를 따로 쓴다).

## 1. 응답 포맷 (전 엔드포인트 공통)

성공: `{ "success": true, "data": { ... } }`
실패: `{ "success": false, "message": "사용자에게 보여줄 한국어 메시지" }`

HTTP 코드: 400 검증실패 / 401 미인증·토큰만료 / 403 권한없음 / 404 없음 / 409 중복 / 500 서버오류.
프론트는 `message` 를 그대로 토스트에 띄운다.

## 2. 인증

- 방식: **JWT Bearer**. `Authorization: Bearer <token>`
- 페이로드: `{ userId, email }`, 만료 `7d`
- 비밀번호: `bcryptjs`, salt rounds 10. 평문 저장 금지, 응답에 절대 포함 금지.
- 프론트는 토큰을 `localStorage['carrot_token']` 에 저장.
- 401 응답을 받으면 프론트는 토큰을 지우고 `#/login` 으로 보낸다.

### User 객체 (모든 응답에서 동일한 모양)

```json
{
  "id": 1,
  "email": "hong@example.com",
  "nickname": "당근왕",
  "regionCode": "1168010100",
  "regionName": "역삼동",
  "regionFullName": "서울 강남구 역삼동",
  "regionRange": 2,
  "regionVerifiedAt": "2026-07-19T02:11:00.000Z",
  "verifyCount": 3,
  "mannerTemp": 36.5,
  "createdAt": "2026-07-19T02:11:00.000Z"
}
```

## 3. DB 스키마 (server.js 의 `initDB()` 가 `CREATE TABLE IF NOT EXISTS` 로 생성)

```sql
carrot_users(
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  region_code TEXT NOT NULL,            -- 법정동 코드(내장 데이터셋의 키)
  region_name TEXT NOT NULL,            -- '역삼동'
  region_full_name TEXT NOT NULL,       -- '서울 강남구 역삼동'
  region_lat DOUBLE PRECISION NOT NULL, -- 인증된 동네 중심 좌표
  region_lng DOUBLE PRECISION NOT NULL,
  region_range SMALLINT NOT NULL DEFAULT 2,  -- 1~4, 내 동네 범위
  region_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verify_count INT NOT NULL DEFAULT 1,
  manner_temp NUMERIC(4,1) NOT NULL DEFAULT 36.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

carrot_products(
  id BIGINT ... PRIMARY KEY,
  seller_id BIGINT NOT NULL REFERENCES carrot_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,                  -- 1~60자
  description TEXT NOT NULL,            -- 1~2000자
  price INT NOT NULL,                   -- 0 이상, 0 = 나눔
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'selling',   -- 'selling' | 'reserved' | 'sold'
  images JSONB NOT NULL DEFAULT '[]',   -- data-URI 문자열 배열, 최대 3장(사용자 확정 요구사항)
  region_code TEXT NOT NULL,            -- 등록 시점 판매자 동네(스냅샷)
  region_name TEXT NOT NULL,
  region_full_name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,        -- 거리 계산용
  lng DOUBLE PRECISION NOT NULL,
  view_count INT NOT NULL DEFAULT 0,
  buyer_id BIGINT REFERENCES carrot_users(id) ON DELETE SET NULL,  -- 거래완료 상대
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bumped_at TIMESTAMPTZ NOT NULL DEFAULT now()   -- 끌어올리기. 목록 정렬 기준
)

carrot_likes(id, product_id → products ON DELETE CASCADE, user_id → users ON DELETE CASCADE,
             created_at, UNIQUE(product_id, user_id))

carrot_chat_rooms(id, product_id, buyer_id, seller_id, created_at,
                  UNIQUE(product_id, buyer_id))

carrot_messages(id, room_id → chat_rooms ON DELETE CASCADE, sender_id, body TEXT, created_at)

carrot_reviews(id, product_id, reviewer_id, target_id, score SMALLINT,  -- -1 | 0 | +1
               comment TEXT, created_at, UNIQUE(product_id, reviewer_id))
```

인덱스: `carrot_products(bumped_at DESC, id DESC)`, `carrot_products(seller_id)`,
`carrot_likes(user_id)`, `carrot_messages(room_id, created_at)`.

## 4. 위치인증(동네 설정) — 이 앱의 핵심

외부 지오코딩 API 키가 없으므로 **server.js 에 동네 좌표 데이터셋을 내장**한다.

- 서울 25개 구의 주요 동 + 성남/수원/고양/용인 일부 = **최소 60개 동**.
  각 항목: `{ code, name, fullName, lat, lng }`.
  좌표는 동 중심의 근사값(오차 ±1km 허용). README 에 "근사 좌표"임을 명시할 것.
- 인증 절차:
  1. 브라우저 `navigator.geolocation.getCurrentPosition()` → `{lat, lng}`
  2. 서버가 **하버사인 거리**로 가장 가까운 동을 찾는다.
  3. 가장 가까운 동이 **8km 초과**면 거부: `"서비스 지역이 아닙니다. 현재 서울·경기 일부만 지원해요."`
  4. 성공하면 그 동을 사용자의 인증 동네로 저장하고 `verify_count += 1`, `region_verified_at = now()`.
- GPS 가 막힌 환경(데스크톱·권한거부)을 위해 프론트는 **좌표 직접 입력 폴백**을 제공한다.
  서버는 두 경로를 구분하지 않는다(같은 `{lat,lng}` 를 받는다). 프론트 UI 에 "테스트용 좌표 입력"이라고 명확히 표시.
  README 에 "실제 당근마켓의 GPS 위변조 방지는 범위 밖"이라고 적을 것.
- `regionRange` 1~4 → 반경 **[2, 4, 7, 12] km**. 피드는 내 동네 중심에서 이 반경 안의 상품만 보여준다.
- 거리 표시: 1km 미만은 `"600m"`, 이상은 `"2.4km"`.

## 5. API 엔드포인트

### 인증 (토큰 불필요)

| 메서드 | 경로 | 요청 body | 응답 data |
|---|---|---|---|
| POST | `/api/location/resolve` | `{lat, lng}` | `{region: {code,name,fullName,lat,lng}, distanceM, nearby: [region…]}` — 가입 전 동네 미리보기 |
| POST | `/api/auth/signup` | `{email, password, nickname, lat, lng}` | `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` | `{token, user}` |

검증: 이메일 형식 / 비밀번호 6자 이상 / 닉네임 2~12자 / 이메일 중복 시 409.
**가입에는 위치인증이 필수** — `lat,lng` 없거나 서비스 지역 밖이면 400.

### 내 정보 (토큰 필요)

| 메서드 | 경로 | body | data |
|---|---|---|---|
| GET | `/api/auth/me` | – | `{user}` |
| PATCH | `/api/me` | `{nickname?, regionRange?}` | `{user}` |
| POST | `/api/me/verify-location` | `{lat, lng}` | `{user, region, distanceM}` — 동네 재인증/변경 |

### 상품 (토큰 필요)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/products` | 쿼리: `scope=near\|mine\|liked` (기본 near), `q`, `category`, `status`, `sort=recent\|price_asc\|price_desc`, `page`(기본1), `limit`(기본20). `near` 는 내 `regionRange` 반경 필터. data: `{items: [ProductCard], page, hasMore, total}` |
| POST | `/api/products` | `{title, description, price, category, images[]}` → `{product}`. 위치는 **토큰의 내 인증 동네를 서버가 박는다**(클라이언트가 못 정함). 201 |
| GET | `/api/products/:id` | `{product: ProductDetail}`. 조회수 +1 (내 글이면 증가 안 함) |
| PATCH | `/api/products/:id` | `{title?,description?,price?,category?,images?,status?}` — 본인 글만, 아니면 403 |
| DELETE | `/api/products/:id` | 본인 글만 |
| POST | `/api/products/:id/bump` | 끌어올리기 → `bumped_at = now()`. 본인 글만. **마지막 끌올 후 1시간 이내면 400** |
| POST | `/api/products/:id/like` | 찜하기 (본인 글은 400) |
| DELETE | `/api/products/:id/like` | 찜 해제 |
| POST | `/api/products/:id/complete` | `{buyerId}` → status='sold', buyer_id 기록. 판매자만 |

**ProductCard** (목록용):
```json
{
  "id": 12, "title": "아이폰 14 프로", "price": 850000, "category": "디지털기기",
  "status": "selling", "thumbnail": "data:image/…", "regionName": "역삼동",
  "distanceText": "1.2km", "likeCount": 3, "chatCount": 1, "viewCount": 42,
  "isLiked": false, "isMine": false, "bumpedAt": "…", "createdAt": "…"
}
```

**ProductDetail** = ProductCard + `{description, images: [...], updatedAt,
seller: {id, nickname, regionName, mannerTemp, verifyCount}, myChatRoomId: 3|null}`

### 채팅 (토큰 필요)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/chats` | 내가 낀 방 목록. `{items:[{id, product:{id,title,thumbnail,price,status}, peer:{id,nickname,mannerTemp}, lastMessage, lastAt, unread}]}` |
| POST | `/api/chats` | `{productId}` → 방 생성 또는 기존 방 반환. `{room}`. 내 상품이면 400 |
| GET | `/api/chats/:roomId/messages` | 참여자만. `{items:[{id, senderId, body, createdAt, isMine}], product, peer}` |
| POST | `/api/chats/:roomId/messages` | `{body}` (1~1000자) → `{message}` |

폴링: 프론트는 채팅방에서 **3초 간격 polling** (WebSocket 안 씀).

### 후기 (토큰 필요)

| POST | `/api/reviews` | `{productId, score, comment?}` — score ∈ {-1,0,1}. 거래완료된 상품의 당사자만.
상대 `manner_temp` 를 `score * 0.5` 만큼 조정(범위 0~99). 중복 작성 409 |

## 6. 카테고리 (프론트/백엔드 동일하게 사용)

`디지털기기, 생활가전, 가구/인테리어, 유아동, 의류, 도서/티켓, 스포츠/레저, 취미/게임, 반려동물, 식물, 기타`

## 7. 프론트 화면 (hash 라우팅)

- `#/login`, `#/signup` — 가입은 **3단계 위저드**: ① 이메일/비번/닉네임 → ② 위치인증(동네 확인) → ③ 완료
- `#/` — 홈 피드(내 동네 상품 목록, 검색, 카테고리 필터, 무한스크롤 or 더보기)
- `#/product/:id` — 상세(이미지 캐러셀, 판매자 매너온도, 찜, 채팅하기, 내 글이면 수정/삭제/끌올/거래완료)
- `#/new`, `#/edit/:id` — 등록/수정 (이미지는 **클라이언트에서 최대 800px·JPEG 0.7 로 리사이즈** 후 data-URI)
- `#/chats`, `#/chat/:roomId`
- `#/my` — 내 프로필, 매너온도, 판매내역/찜목록, 동네 재인증, 동네 범위 슬라이더(1~4)
- 미로그인 상태로 `#/` 진입 시 `#/login` 으로 리다이렉트. 최초 진입 = 로그인/가입 화면.

## 8. 디자인

- 당근마켓 톤: 메인 오렌지 `#FF6F0F`, 배경 흰색, 회색 `#868B94`, 라운드 큼직하게.
- **모바일 우선**. 데스크톱에서는 가운데 정렬된 최대 480px 폰 프레임 안에 렌더.
- 하단 탭바: 홈 / 채팅 / 나의당근.
- 한글 줄바꿈 `word-break: keep-all`.
- 상대시간 표기: "방금 전", "3분 전", "2시간 전", "어제", "3일 전".
