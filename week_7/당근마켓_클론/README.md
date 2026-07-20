# 당근마켓 클론 — 위치인증 기반 중고거래 앱

## 🥕 https://quest-carrot-market.vercel.app

바로 로그인해서 둘러볼 수 있는 **데모 계정**:

| | |
|---|---|
| 이메일 | `demo@carrot.dev` |
| 비밀번호 | `demo1234` |

> 신규 가입도 해볼 수 있다. 2단계 위치인증에서 브라우저가 GPS 권한을 물어보는데,
> **거부하거나 데스크톱이라 안 잡히면 "테스트용 좌표 직접 입력" 폴백이 자동으로 열린다**
> (강남역·홍대입구·잠실 등 원클릭 버튼 제공). 서울·경기 밖 좌표는 의도적으로 거부된다.
>
> 채팅을 보려면 계정을 하나 더 만들어 데모 계정의 상품에 채팅을 걸면 된다
> (자기 상품에는 채팅이 안 걸린다).

📹 `시연영상.mp4` — 가입 → 상품 등록 → 검색 → 채팅 전 과정 46초.

---

`SPEC.md` 가 프론트(`index.html`/`client.js`)와 백엔드(`server.js`)의 계약서다.

- **스택**: Express 4 + PostgreSQL(Supabase) + JWT(`jsonwebtoken`) + `bcryptjs` + `dotenv`
- **포트**: 3007 고정
- **테이블 접두사**: `carrot_` — 공용 Supabase 를 다른 quest 앱과 공유하므로 충돌을 피한다.
  기존 공용 `users` 테이블은 건드리지 않는다(이 앱은 `carrot_users` 를 따로 쓴다).

---

## DB 연결 (해결 완료 — 기록용)

`week_7/.env` 에 원래 적혀 있던 접속 문자열은 **작동하지 않았고**, 원인이 두 개였다.

1. **직결 호스트가 IPv6 전용** — `db.<ref>.supabase.co` 는 AAAA 레코드만 있어서(`2600:1f18:...`)
   전역 IPv6 가 없는 PC 에서는 `getaddrinfo` 가 `ENOTFOUND` 로 죽는다.
   Supabase 가 직결 연결의 IPv4 를 유료화하면서 생긴 문제다.
2. **비밀번호 거부** — 풀러로 우회해도 `28P01 password authentication failed`.
   (없는 프로젝트는 `XX000 Tenant or user not found` 라는 *다른* 에러가 나므로,
   프로젝트는 실재하고 비밀번호만 틀렸다는 뜻이었다.)

**현재는 week_5·week_6 과 같은 공용 Supabase 프로젝트를 쓴다** — 이 워크스페이스의 기존 관례다.
테이블이 전부 `carrot_` 접두사라 다른 앱(`cafe_*`, `ledger_*`, `shop_*`, `users`)과 충돌하지 않는다.

> week_7 전용 프로젝트로 되돌리려면 Supabase 대시보드 → Settings → Database → *Reset database password*
> 로 비밀번호를 새로 받고, **"Transaction pooler" 탭의 문자열**을 쓴다(사용자명이 `postgres` 가 아니라
> `postgres.<프로젝트ref>`, 포트는 6543):
> ```
> DATABASE_URL=postgresql://postgres.<ref>:<새비밀번호>@aws-1-us-east-1.pooler.supabase.com:6543/postgres
> ```
> 테이블은 첫 요청 때 `initDB()` 가 자동 생성하지만 **데모 데이터는 다시 넣어야 한다**(맨 아래 재시딩 참고).

---

## 배포

Vercel **CLI 수동 배포**다. git push 만으로는 갱신되지 않는다.

```bash
cd quest/week_7/당근마켓_클론
vercel --prod
```

- 프로젝트: `g1nnu-s-projects/quest-carrot-market`
- 환경변수 `DATABASE_URL`, `JWT_SECRET` 은 Vercel 대시보드에 등록되어 있다(`vercel env ls` 로 확인).
  `.env` 파일은 `.vercelignore` 로 업로드에서 제외된다.
- `vercel.json` 이 모든 경로를 `server.js` 로 보내고, `includeFiles` 로 `index.html`/`client.js` 를 함께 번들한다.

> 채팅은 3초 폴링이라 **채팅방을 열어둔 사람 1명당 분당 20회 함수 호출**이 발생한다.
> 지금 규모는 무료 한도로 충분하지만, 사용자가 늘면 폴링 간격을 늘리거나 SSE 로 바꾸는 편이 낫다.

---

## 로컬 실행

```bash
cd quest/week_7/당근마켓_클론
npm install
npm start          # 또는 node server.js
# → 당근마켓 클론 서버 실행 중: http://localhost:3007
```

환경변수는 두 파일에서 읽고 **로컬이 우선**이다.

```js
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });               // DATABASE_URL
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });     // JWT_SECRET, PORT
```

> 로컬 `.env` 는 `override: true` 라서 **셸 환경변수보다 우선한다.** `PORT=3099 node server.js` 로는 포트가 안 바뀐다
> (`.env` 의 `PORT` 가 이긴다). 포트를 바꾸려면 로컬 `.env` 를 고쳐야 한다.

---

## API

응답은 전부 `{ success, data }` 또는 `{ success, message }` 형태다.
상태코드: 400 검증실패 / 401 미인증·토큰만료 / 403 권한없음 / 404 없음 / 409 중복 / 500 서버오류.

### 토큰 불필요

| 메서드 | 경로 | 요청 | 응답 `data` |
|---|---|---|---|
| POST | `/api/location/resolve` | `{lat,lng}` | `{region:{code,name,fullName,lat,lng}, distanceM, nearby:[…]}` |
| POST | `/api/auth/signup` | `{email,password,nickname,lat,lng}` | `{token,user}` · 201 |
| POST | `/api/auth/login` | `{email,password}` | `{token,user}` |

### 내 정보 (Bearer 토큰)

| 메서드 | 경로 | 요청 | 응답 `data` |
|---|---|---|---|
| GET | `/api/auth/me` | – | `{user}` |
| PATCH | `/api/me` | `{nickname?, regionRange?}` | `{user}` |
| POST | `/api/me/verify-location` | `{lat,lng}` | `{user, region, distanceM}` |

### 상품 (Bearer 토큰)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/products` | `scope=near\|mine\|liked`(기본 near), `q`, `category`, `status`, `sort=recent\|price_asc\|price_desc`, `page`(1), `limit`(20, 최대 50) → `{items,page,hasMore,total}` |
| POST | `/api/products` | `{title,description,price,category,images[]}` → `{product}` · 201 |
| GET | `/api/products/:id` | `{product}`. 조회수 +1(내 글 제외) |
| PATCH | `/api/products/:id` | `{title?,description?,price?,category?,images?,status?}` → `{product}`. 본인만(403) |
| DELETE | `/api/products/:id` | `{id}`. 본인만(403) |
| POST | `/api/products/:id/bump` | 끌어올리기 → `{product}`. 본인만. 1시간 쿨다운(400) |
| POST | `/api/products/:id/like` | → `{liked:true, likeCount}`. 내 상품이면 400 |
| DELETE | `/api/products/:id/like` | → `{liked:false, likeCount}` |
| POST | `/api/products/:id/complete` | `{buyerId}` → `{product}`. 판매자만 |

### 채팅 / 후기 (Bearer 토큰)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/chats` | `{items:[{id,product,peer,lastMessage,lastAt,unread}]}` |
| POST | `/api/chats` | `{productId}` → `{room}` · 201. 내 상품이면 400 |
| GET | `/api/chats/:roomId/messages` | `{items,product,peer}`. 참여자만(403). **읽는 순간 읽음 처리** |
| POST | `/api/chats/:roomId/messages` | `{body}` (1~1000자) → `{message}` · 201 |
| POST | `/api/reviews` | `{productId, score, comment?}` → `{review, targetMannerTemp}` · 201. 중복 409 |

### 검증 규칙

| 항목 | 규칙 |
|---|---|
| 이메일 | 형식 검사, 중복 시 409 |
| 비밀번호 | 6자 이상, bcrypt salt 10. **어떤 응답에도 안 나감** |
| 닉네임 | 2~12자 |
| 제목 / 설명 | 1~60자 / 1~2000자 |
| 가격 | 0 이상 정수(0 = 나눔), 최대 999,999,999 |
| 카테고리 | 화이트리스트 11종 (`디지털기기, 생활가전, 가구/인테리어, 유아동, 의류, 도서/티켓, 스포츠/레저, 취미/게임, 반려동물, 식물, 기타`) |
| 이미지 | **최대 3장**, 각 `data:image/…` 또는 `http(s)://`, 1장당 2,000,000자 이하 |
| 요청 본문 | `express.json({ limit: '12mb' })` — data-URI 대응. 초과 시 400 |

---

## DB 스키마

`initDB()` 가 첫 `/api` 요청 때 `CREATE TABLE IF NOT EXISTS` 로 만든다(`dbInitialized` 플래그로 1회만).

```
carrot_users      id, email(UNIQUE), password_hash, nickname,
                  region_code, region_name, region_full_name, region_lat, region_lng,
                  region_range(1~4, 기본2), region_verified_at, verify_count,
                  manner_temp NUMERIC(4,1) 기본 36.5, created_at
carrot_products   id, seller_id→users, title, description, price, category,
                  status('selling'|'reserved'|'sold'), images JSONB,
                  region_code/name/full_name, lat, lng,   ← 등록 시점 판매자 동네 스냅샷
                  view_count, buyer_id→users, created_at, updated_at, bumped_at
carrot_likes      id, product_id, user_id, created_at, UNIQUE(product_id,user_id)
carrot_chat_rooms id, product_id, buyer_id, seller_id, created_at,
                  buyer_last_read_at, seller_last_read_at,   ← unread 계산용(SPEC 추가분)
                  UNIQUE(product_id,buyer_id)
carrot_messages   id, room_id, sender_id, body, created_at
carrot_reviews    id, product_id, reviewer_id, target_id, score(-1|0|1), comment,
                  created_at, UNIQUE(product_id,reviewer_id)
```

인덱스: `products(bumped_at DESC,id DESC)`, `products(seller_id)`, `likes(user_id)`, `messages(room_id,created_at)`.

> `buyer_last_read_at` / `seller_last_read_at` 는 SPEC 스키마에 없던 컬럼이다. 채팅 목록의 `unread` 를
> **실제로** 계산하려면 읽음 시점이 필요해서 추가했다. 응답 필드는 계약 그대로(`unread`: 숫자)이고,
> 기존 테이블에도 `ALTER TABLE … ADD COLUMN IF NOT EXISTS` 로 멱등하게 붙는다.

---

## 위치인증 동작

외부 지오코딩 API 키가 없어서 **동네 좌표 데이터셋을 `server.js` 에 내장**했다.

- **106개 동** — 서울 25개 구 전체(83개 동) + 경기(성남·수원·고양·용인) 23개 동.
- 각 항목: `{ code, name, fullName, lat, lng }`.
- **좌표는 동 중심의 "근사 좌표"다.** 실제 행정경계가 아니라 대표 지점 하나로 그 동을 대신한다(오차 ±1km 수준).
  지역 코드도 앞 5자리(시군구)만 실제 행정표준코드이고, 뒤 5자리는 이 데이터셋의 내부 키다.
- 판정: 받은 `{lat,lng}` 에서 **하버사인 거리**로 가장 가까운 동을 고른다.
  가장 가까운 동이 **8km 를 넘으면 거부** → 400 `"서비스 지역이 아닙니다. 현재 서울·경기 일부만 지원해요."`
- 성공하면 그 동을 사용자의 인증 동네로 저장하고 `verify_count += 1`, `region_verified_at = now()`.
- **피드 반경**: `regionRange` 1~4 → **[2, 4, 7, 12] km**. `scope=near` 는 내 동네 중심에서 이 반경 안의 상품만 준다.
  거리 계산은 SQL 안에서 하버사인으로 처리한다.
- **거리 표기**: 1km 미만은 10m 단위(`"600m"`), 이상은 소수점 한 자리(`"2.4km"`).

### 한계 (의도적)

- 상품 좌표는 **판매자 동네의 중심점**이라, 같은 동 상품끼리는 거리가 정확히 **`"0m"`** 로 나온다. 버그가 아니다.
- **실제 당근마켓의 GPS 위변조 방지는 이 프로젝트 범위 밖이다.** 서버는 브라우저가 보낸 좌표를 그대로 믿는다.
  프론트의 "좌표 직접 입력" 폴백과 `navigator.geolocation` 결과를 서버는 **구분하지 않는다**(같은 `{lat,lng}` 를 받는다).

---

## 보안 / 신뢰 경계

- **서버가 신뢰의 원천**: 상품 등록 시 `seller_id` 와 위치(`lat/lng`, `region_*`)는 **토큰의 내 인증 동네에서 서버가 박는다.**
  클라이언트가 `sellerId` / `lat` / `lng` 를 보내도 **읽지 않는다**(테스트로 위조값을 넣어 무시되는 것까지 확인함).
- **소유권은 SQL 레벨에서 강제**: 수정·삭제·끌올·거래완료 쿼리에 항상 `WHERE … AND seller_id = 나` 가 들어간다.
  0행이면 그때 404(없음)/403(남의 글)을 가려낸다. UI 숨김에 의존하지 않는다.
- **채팅**은 방의 `buyer_id`/`seller_id` 본인만 읽고 쓸 수 있다(제3자 403).
- 로그인 실패는 "이메일 없음"과 "비번 틀림"을 **구분하지 않는다**(계정 존재 여부 노출 방지).
- `express.static` 은 `dotfiles: 'ignore'` 라 **`GET /.env` 로 `JWT_SECRET` 이 새지 않는다**(확인함).
  다만 `GET /server.js` 는 소스가 그대로 보인다 — 3-file 구조상 같은 폴더를 정적 서빙해야 해서 그렇고,
  server.js 에 하드코딩된 비밀값은 없다(전부 `.env`).

---

## 데모 계정 / 데이터

**공용 Supabase 프로젝트(week_5·week_6 과 동일)에 들어가 있다.** 배포본과 로컬이 같은 DB 를 본다.

| | |
|---|---|
| 이메일 | `demo@carrot.dev` |
| 비밀번호 | `demo1234` |
| 닉네임 | 당근데모 |
| 동네 | 서울 서초구 반포동 (매너온도 36.5) |

> 동네는 앱에서 재인증하면 바뀐다. 아래 상품 6건의 동네는 **등록 시점 스냅샷**이라
> 판매자가 이사해도 따라 움직이지 않는다(당근마켓과 같은 동작).

상품 6건(전부 `selling`, 이미지 1장씩, 등록시각을 5시간 간격으로 벌려둬서 최신순 정렬이 눈에 보인다):

| 제목 | 가격 | 카테고리 |
|---|---|---|
| 몬스테라 화분 나눔합니다 | 0 (나눔) | 식물 |
| 한강 러닝화 나이키 270mm | 45,000 | 스포츠/레저 |
| 아기 사이즈 유아 원목 책상 | 20,000 | 유아동 |
| 다이슨 V11 무선청소기 | 250,000 | 생활가전 |
| 닌텐도 스위치 OLED + 게임 3종 | 320,000 | 취미/게임 |
| 시디즈 T50 의자 (거의 새것) | 180,000 | 가구/인테리어 |

썸네일은 외부 이미지 없이 **SVG data-URI**(단색 배경 + 라벨)로 넣었다. 실제 사진이 아니라 자리표시용이다.

프론트에서 붙어볼 때는 **강남역 좌표 `37.4979, 127.0276`** 으로 가입/인증하면 역삼동이 잡혀서
데모 상품 6건이 전부 `0m` 거리로 피드에 뜬다. 채팅·거래완료·후기를 보려면 본인 계정을 하나 더 만들어
데모 계정의 상품에 채팅을 걸면 된다(자기 상품에는 채팅이 안 걸린다).

### 데모 데이터 재시딩 (DB 를 갈아끼운 경우)

```bash
# 1) 데모 계정 생성 — 강남역 좌표로 위치인증
curl -X POST http://localhost:3007/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@carrot.dev","password":"demo1234","nickname":"당근데모","lat":37.4979,"lng":127.0276}'

# 2) 응답의 token 으로 상품 등록 (원하는 만큼 반복)
curl -X POST http://localhost:3007/api/products \
  -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" \
  -d '{"title":"다이슨 V11 무선청소기","description":"헤드 3종 다 있어요.","price":250000,"category":"생활가전","images":[]}'
```

---

## 검증 결과

실제 Supabase 에 붙여 엔드투엔드로 **148개 항목 전부 통과(0 실패)**. 확인한 것들:

- 위치: 강남 좌표 → 역삼동(0m) / 제주 좌표 → 400 거부 / 좌표 누락 → 400
- 인증: 가입·로그인·me, 중복 이메일 409, 위치 없는 가입 400, 잘못된·없는 토큰 401,
  로그인 실패 메시지가 두 경우 동일, 응답에 password/hash 미포함
- 상품: 등록·목록·상세·수정·삭제, `sellerId`/`lat`/`lng` 위조 무시, 조회수(내 글 제외),
  **이미지 4장 400 / 3장 201**, 카테고리 화이트리스트, 음수 가격, 제목 61자
- **목록 3조건 동시**(`category=디지털기기&q=아이폰&sort=recent`): 미끼 상품으로 AND 동작 확인 —
  카테고리만 맞는 것·키워드만 맞는 것은 제외되고, 설명에만 키워드가 있는 것은 포함, 최신순 유지
- **대소문자 무시 검색**: `IPHONE`/`iphone`/`IpHoNe`/`apple` 전부 매칭. 검색어 `%` 는 리터럴 처리
- **권한**: B 가 A 의 상품 수정·삭제·끌올·거래완료 시도 → **전부 403**, 원본 데이터 불변
- 찜(중복/내 글 400/해제), 끌올 쿨다운 400 → 2시간 경과 후 200
- 채팅: 방 재사용, 제3자 접근 403, unread 계산·읽음 처리, lastMessage
- 거래완료·후기: 매너온도 36.5 → 37.0, 중복 후기 409, 당사자 아니면 403
- 반경: 잠실(range 4=12km)에서 역삼동 상품 4.4km 로 보임 → range 1(2km)로 줄이면 제외
- DB: `carrot_` 6개 테이블·인덱스 생성 확인, 다른 앱 테이블(`users`, `cafe_*`, `ledger_*`, `shop_*`) 무손상
