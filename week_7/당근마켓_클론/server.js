// ============================================================
// 당근마켓 클론 API server (email/password + JWT auth + 위치인증)
// Express + PostgreSQL (Supabase) — 3-file architecture:
// server.js / index.html / client.js
//
// 계약서: 같은 폴더의 SPEC.md. 경로·필드명·타입은 그 문서를 따른다.
//
// 데이터 모델:
//   carrot_users      : 계정 + 인증된 동네(region_*) + 매너온도
//   carrot_products   : 상품 1건 = 1행. 등록 시점 판매자 동네를 스냅샷으로 박는다.
//   carrot_likes      : 찜 (UNIQUE(product_id, user_id))
//   carrot_chat_rooms : 상품 1개 + 구매자 1명 = 방 1개 (UNIQUE(product_id, buyer_id))
//   carrot_messages   : 채팅 메시지
//   carrot_reviews    : 거래 후기 (UNIQUE(product_id, reviewer_id))
//
// 권한 규칙:
//   - /api/location/resolve, /api/auth/signup, /api/auth/login 을 뺀 모든 API 는 JWT 필요.
//   - 상품 수정/삭제/끌올/거래완료: 본인 글만. SQL 에 WHERE seller_id = 나 를 직접 박는다.
//   - 채팅: 방의 buyer/seller 본인만 읽고 쓸 수 있다.
//   - 상품의 위치와 판매자는 서버가 토큰에서 가져와 박는다(클라이언트가 못 정한다).
//
// 공용 Supabase 를 다른 quest 앱과 공유하므로 이 앱의 테이블은 전부 carrot_ 접두사.
// 다른 앱이 쓰는 공용 users 테이블은 건드리지 않는다.
// ============================================================

const path = require('path');

// DATABASE_URL 은 상위 quest/week_7/.env (공용 Supabase),
// JWT_SECRET/PORT 는 앱 로컬 .env. 로컬이 우선이므로 override: true 로 나중에 덮는다.
// cwd 가 어디든 동작하도록 두 경로 모두 __dirname 기준 절대경로로 준다.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3007;

// .trim() guards against trailing-newline quirks in platform env vars.
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const SALT_ROUNDS = 10;
const TOKEN_TTL = '7d';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 입력 길이/값 상한 — 프론트 maxLength 와 맞춘다.
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 12;
const PASSWORD_MIN = 6;
const TITLE_MAX = 60;
const DESC_MAX = 2000;
const PRICE_MAX = 999999999; // INT 범위 안에서 넉넉하게
const IMAGES_MAX = 3; // SPEC ★ 확정 요구사항 A — 기존 5장에서 3장으로 변경됨.
const IMAGE_CHARS_MAX = 2000000; // data-URI 1장 상한(약 1.5MB 원본)
const MESSAGE_MAX = 1000;
const COMMENT_MAX = 300;
const PAGE_LIMIT_MAX = 50;

// SPEC 6절 — 프론트와 반드시 동일해야 한다.
const CATEGORIES = [
  '디지털기기', '생활가전', '가구/인테리어', '유아동', '의류',
  '도서/티켓', '스포츠/레저', '취미/게임', '반려동물', '식물', '기타',
];
const STATUSES = ['selling', 'reserved', 'sold'];

// regionRange 1~4 → 피드 반경(km). SPEC 4절.
const RANGE_KM = [2, 4, 7, 12];
// 가장 가까운 동이 이 거리를 넘으면 서비스 지역 밖으로 본다.
const MAX_VERIFY_DISTANCE_M = 8000;

// ------------------------------------------------------------
// 동네 좌표 데이터셋 (외부 지오코딩 API 없이 위치인증을 하기 위한 내장 테이블)
//
// [법정동코드, 동이름, 표시용 전체이름, 위도, 경도]
// 좌표는 동 중심의 "근사값"이다(오차 ±1km 허용). 실제 행정경계가 아니라
// 대표 지점 하나로 그 동을 대신하므로, 같은 동에 등록된 상품끼리의 거리는 0m 가 된다.
// 코드 앞 5자리(시군구)는 실제 행정표준코드이고, 뒤 5자리는 이 데이터셋의 내부 키다.
// ------------------------------------------------------------
const REGION_ROWS = [
  // ── 서울 종로구 ──
  ['1111017100', '혜화동', '서울 종로구 혜화동', 37.5860, 127.0015],
  ['1111013800', '평창동', '서울 종로구 평창동', 37.6070, 126.9720],
  // ── 서울 중구 ──
  ['1114017400', '신당동', '서울 중구 신당동', 37.5606, 127.0110],
  ['1114014000', '명동', '서울 중구 명동', 37.5636, 126.9850],
  ['1114018300', '황학동', '서울 중구 황학동', 37.5680, 127.0210],
  // ── 서울 용산구 ──
  ['1117013300', '이태원동', '서울 용산구 이태원동', 37.5345, 126.9945],
  ['1117013200', '한남동', '서울 용산구 한남동', 37.5340, 127.0020],
  ['1117011700', '이촌동', '서울 용산구 이촌동', 37.5220, 126.9680],
  // ── 서울 성동구 ──
  ['1120011500', '성수동', '서울 성동구 성수동', 37.5445, 127.0560],
  ['1120010800', '행당동', '서울 성동구 행당동', 37.5610, 127.0300],
  ['1120010600', '옥수동', '서울 성동구 옥수동', 37.5400, 127.0180],
  // ── 서울 광진구 ──
  ['1121510300', '광장동', '서울 광진구 광장동', 37.5470, 127.1030],
  ['1121510200', '자양동', '서울 광진구 자양동', 37.5340, 127.0790],
  ['1121510700', '화양동', '서울 광진구 화양동', 37.5460, 127.0700],
  // ── 서울 동대문구 ──
  ['1123010600', '회기동', '서울 동대문구 회기동', 37.5895, 127.0530],
  ['1123010900', '장안동', '서울 동대문구 장안동', 37.5730, 127.0640],
  ['1123010800', '답십리동', '서울 동대문구 답십리동', 37.5710, 127.0530],
  // ── 서울 중랑구 ──
  ['1126010100', '면목동', '서울 중랑구 면목동', 37.5860, 127.0870],
  ['1126010300', '상봉동', '서울 중랑구 상봉동', 37.5960, 127.0850],
  ['1126010400', '묵동', '서울 중랑구 묵동', 37.6120, 127.0770],
  // ── 서울 성북구 ──
  ['1129013900', '정릉동', '서울 성북구 정릉동', 37.6070, 127.0150],
  ['1129013600', '길음동', '서울 성북구 길음동', 37.6050, 127.0250],
  ['1129013500', '돈암동', '서울 성북구 돈암동', 37.5960, 127.0170],
  // ── 서울 강북구 ──
  ['1130510100', '미아동', '서울 강북구 미아동', 37.6280, 127.0250],
  ['1130510200', '수유동', '서울 강북구 수유동', 37.6380, 127.0250],
  ['1130510300', '번동', '서울 강북구 번동', 37.6320, 127.0400],
  // ── 서울 도봉구 ──
  ['1132010700', '창동', '서울 도봉구 창동', 37.6530, 127.0470],
  ['1132010600', '쌍문동', '서울 도봉구 쌍문동', 37.6480, 127.0340],
  ['1132010500', '방학동', '서울 도봉구 방학동', 37.6650, 127.0350],
  // ── 서울 노원구 ──
  ['1135010200', '상계동', '서울 노원구 상계동', 37.6600, 127.0600],
  ['1135010300', '중계동', '서울 노원구 중계동', 37.6440, 127.0640],
  ['1135010500', '공릉동', '서울 노원구 공릉동', 37.6250, 127.0730],
  // ── 서울 은평구 ──
  ['1138010100', '응암동', '서울 은평구 응암동', 37.5950, 126.9200],
  ['1138010300', '불광동', '서울 은평구 불광동', 37.6100, 126.9300],
  ['1138010400', '갈현동', '서울 은평구 갈현동', 37.6190, 126.9180],
  // ── 서울 서대문구 ──
  ['1141011700', '연희동', '서울 서대문구 연희동', 37.5700, 126.9330],
  ['1141012100', '홍제동', '서울 서대문구 홍제동', 37.5880, 126.9440],
  ['1141011600', '신촌동', '서울 서대문구 신촌동', 37.5590, 126.9410],
  // ── 서울 마포구 ──
  ['1144012700', '연남동', '서울 마포구 연남동', 37.5630, 126.9250],
  ['1144012000', '합정동', '서울 마포구 합정동', 37.5490, 126.9130],
  ['1144013300', '상암동', '서울 마포구 상암동', 37.5790, 126.8890],
  ['1144012900', '망원동', '서울 마포구 망원동', 37.5560, 126.9040],
  // ── 서울 양천구 ──
  ['1147010100', '목동', '서울 양천구 목동', 37.5310, 126.8750],
  ['1147010200', '신정동', '서울 양천구 신정동', 37.5170, 126.8560],
  ['1147010300', '신월동', '서울 양천구 신월동', 37.5290, 126.8360],
  // ── 서울 강서구 ──
  ['1150010200', '화곡동', '서울 강서구 화곡동', 37.5410, 126.8400],
  ['1150010300', '등촌동', '서울 강서구 등촌동', 37.5510, 126.8650],
  ['1150010500', '마곡동', '서울 강서구 마곡동', 37.5600, 126.8280],
  ['1150010600', '방화동', '서울 강서구 방화동', 37.5750, 126.8130],
  // ── 서울 구로구 ──
  ['1153010200', '구로동', '서울 구로구 구로동', 37.4950, 126.8880],
  ['1153010100', '신도림동', '서울 구로구 신도림동', 37.5090, 126.8890],
  ['1153010600', '개봉동', '서울 구로구 개봉동', 37.4950, 126.8580],
  // ── 서울 금천구 ──
  ['1154510100', '가산동', '서울 금천구 가산동', 37.4790, 126.8830],
  ['1154510200', '독산동', '서울 금천구 독산동', 37.4670, 126.8950],
  ['1154510300', '시흥동', '서울 금천구 시흥동', 37.4530, 126.9030],
  // ── 서울 영등포구 ──
  ['1156011000', '여의도동', '서울 영등포구 여의도동', 37.5250, 126.9250],
  ['1156010100', '영등포동', '서울 영등포구 영등포동', 37.5180, 126.9070],
  ['1156012700', '문래동', '서울 영등포구 문래동', 37.5170, 126.8950],
  // ── 서울 동작구 ──
  ['1159010200', '상도동', '서울 동작구 상도동', 37.5010, 126.9450],
  ['1159010300', '사당동', '서울 동작구 사당동', 37.4780, 126.9760],
  ['1159010100', '흑석동', '서울 동작구 흑석동', 37.5080, 126.9620],
  ['1159010400', '노량진동', '서울 동작구 노량진동', 37.5130, 126.9420],
  // ── 서울 관악구 ──
  ['1162010100', '봉천동', '서울 관악구 봉천동', 37.4820, 126.9520],
  ['1162010200', '신림동', '서울 관악구 신림동', 37.4840, 126.9290],
  ['1162010300', '남현동', '서울 관악구 남현동', 37.4720, 126.9760],
  // ── 서울 서초구 ──
  ['1165010800', '서초동', '서울 서초구 서초동', 37.4910, 127.0080],
  ['1165010700', '반포동', '서울 서초구 반포동', 37.5040, 127.0050],
  ['1165010600', '방배동', '서울 서초구 방배동', 37.4830, 126.9930],
  ['1165010900', '잠원동', '서울 서초구 잠원동', 37.5140, 127.0110],
  // ── 서울 강남구 ──
  ['1168010100', '역삼동', '서울 강남구 역삼동', 37.4980, 127.0370],
  ['1168010800', '논현동', '서울 강남구 논현동', 37.5110, 127.0220],
  ['1168010400', '청담동', '서울 강남구 청담동', 37.5250, 127.0470],
  ['1168010500', '삼성동', '서울 강남구 삼성동', 37.5140, 127.0565],
  ['1168010600', '대치동', '서울 강남구 대치동', 37.4940, 127.0630],
  ['1168010700', '신사동', '서울 강남구 신사동', 37.5210, 127.0230],
  // ── 서울 송파구 ──
  ['1171010100', '잠실동', '서울 송파구 잠실동', 37.5090, 127.0850],
  ['1171010500', '방이동', '서울 송파구 방이동', 37.5140, 127.1130],
  ['1171010700', '가락동', '서울 송파구 가락동', 37.4950, 127.1180],
  ['1171010800', '문정동', '서울 송파구 문정동', 37.4860, 127.1220],
  // ── 서울 강동구 ──
  ['1174010100', '천호동', '서울 강동구 천호동', 37.5390, 127.1290],
  ['1174010200', '성내동', '서울 강동구 성내동', 37.5310, 127.1260],
  ['1174010400', '길동', '서울 강동구 길동', 37.5370, 127.1400],
  ['1174010600', '명일동', '서울 강동구 명일동', 37.5510, 127.1440],
  // ── 경기 성남시 ──
  ['4113510800', '정자동', '경기 성남시 분당구 정자동', 37.3670, 127.1080],
  ['4113510900', '서현동', '경기 성남시 분당구 서현동', 37.3850, 127.1230],
  ['4113511000', '야탑동', '경기 성남시 분당구 야탑동', 37.4110, 127.1290],
  ['4113511100', '판교동', '경기 성남시 분당구 판교동', 37.3850, 127.0950],
  ['4113110300', '신흥동', '경기 성남시 수정구 신흥동', 37.4400, 127.1420],
  ['4113310400', '상대원동', '경기 성남시 중원구 상대원동', 37.4290, 127.1650],
  // ── 경기 수원시 ──
  ['4111710300', '영통동', '경기 수원시 영통구 영통동', 37.2500, 127.0710],
  ['4111710200', '원천동', '경기 수원시 영통구 원천동', 37.2790, 127.0530],
  ['4111510700', '인계동', '경기 수원시 팔달구 인계동', 37.2650, 127.0300],
  ['4111110700', '정자동', '경기 수원시 장안구 정자동', 37.3010, 126.9930],
  ['4111310400', '권선동', '경기 수원시 권선구 권선동', 37.2560, 127.0170],
  // ── 경기 고양시 ──
  ['4128510300', '마두동', '경기 고양시 일산동구 마두동', 37.6540, 126.7790],
  ['4128510500', '장항동', '경기 고양시 일산동구 장항동', 37.6600, 126.7660],
  ['4128710300', '주엽동', '경기 고양시 일산서구 주엽동', 37.6720, 126.7580],
  ['4128710400', '대화동', '경기 고양시 일산서구 대화동', 37.6800, 126.7480],
  ['4128110900', '화정동', '경기 고양시 덕양구 화정동', 37.6350, 126.8320],
  ['4128111000', '행신동', '경기 고양시 덕양구 행신동', 37.6220, 126.8340],
  // ── 경기 용인시 ──
  ['4146510300', '죽전동', '경기 용인시 수지구 죽전동', 37.3250, 127.1070],
  ['4146510100', '풍덕천동', '경기 용인시 수지구 풍덕천동', 37.3220, 127.0950],
  ['4146510500', '상현동', '경기 용인시 수지구 상현동', 37.2960, 127.0680],
  ['4146310100', '신갈동', '경기 용인시 기흥구 신갈동', 37.2830, 127.1120],
  ['4146310200', '구갈동', '경기 용인시 기흥구 구갈동', 37.2750, 127.1150],
  ['4146110100', '김량장동', '경기 용인시 처인구 김량장동', 37.2350, 127.2050],
];

const REGIONS = REGION_ROWS.map(([code, name, fullName, lat, lng]) => ({
  code, name, fullName, lat, lng,
}));

// ------------------------------------------------------------
// 위치 계산 helpers
// ------------------------------------------------------------

// 하버사인 거리(미터). 지구 반지름 6371km.
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// 좌표에서 가까운 순으로 동네를 정렬. [{ ...region, distanceM }]
function rankRegions(lat, lng) {
  return REGIONS
    .map((r) => ({ ...r, distanceM: Math.round(haversineM(lat, lng, r.lat, r.lng)) }))
    .sort((a, b) => a.distanceM - b.distanceM);
}

// 거리 표기: 1km 미만은 10m 단위 "600m", 이상은 "2.4km". SPEC 4절.
function formatDistance(meters) {
  const m = Number(meters) || 0;
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

// body 의 lat/lng 를 검증. 통과하면 {lat,lng}, 아니면 res 로 400 후 null.
function readLatLng(req, res) {
  const lat = Number(req.body && req.body.lat);
  const lng = Number(req.body && req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ success: false, message: '위치 정보가 올바르지 않습니다.' });
    return null;
  }
  return { lat, lng };
}

// 좌표 → 가장 가까운 동네. 8km 초과면 res 로 400 후 null. SPEC 4절.
function resolveRegion(lat, lng, res) {
  const ranked = rankRegions(lat, lng);
  const nearest = ranked[0];
  if (!nearest || nearest.distanceM > MAX_VERIFY_DISTANCE_M) {
    res.status(400).json({
      success: false,
      message: '서비스 지역이 아닙니다. 현재 서울·경기 일부만 지원해요.',
    });
    return null;
  }
  return { nearest, ranked };
}

// ------------------------------------------------------------
// PostgreSQL pool (Supabase pooler requires SSL)
// .trim() guards against trailing-newline quirks in env vars.
// ------------------------------------------------------------
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// Supabase 풀러는 유휴 커넥션을 먼저 끊는다. pg Pool 은 그때 'error' 이벤트를 내는데
// 리스너가 없으면 Node 가 그대로 프로세스를 죽인다(로그도 안 남는다).
// 유휴 커넥션 사망은 정상 상황이므로 로그만 남기고 살아있는다 — 다음 요청은 새 커넥션을 받는다.
pool.on('error', err => {
  console.error('[pool] 유휴 커넥션 오류(무시하고 계속):', err && err.message);
});

// ------------------------------------------------------------
// Lazy migration: 테이블을 한 번만 만든다. 플래그가 있어야 매 요청/콜드스타트마다
// CREATE TABLE 이 다시 돌지 않는다.
// ------------------------------------------------------------
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carrot_users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      region_code TEXT NOT NULL,
      region_name TEXT NOT NULL,
      region_full_name TEXT NOT NULL,
      region_lat DOUBLE PRECISION NOT NULL,
      region_lng DOUBLE PRECISION NOT NULL,
      region_range SMALLINT NOT NULL DEFAULT 2,
      region_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      verify_count INT NOT NULL DEFAULT 1,
      manner_temp NUMERIC(4,1) NOT NULL DEFAULT 36.5,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carrot_products (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      seller_id BIGINT NOT NULL REFERENCES carrot_users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price INT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'selling',
      images JSONB NOT NULL DEFAULT '[]',
      region_code TEXT NOT NULL,
      region_name TEXT NOT NULL,
      region_full_name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      view_count INT NOT NULL DEFAULT 0,
      buyer_id BIGINT REFERENCES carrot_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      bumped_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carrot_likes (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES carrot_products(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES carrot_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (product_id, user_id)
    );
  `);

  // buyer_last_read_at / seller_last_read_at 은 SPEC 스키마에는 없지만
  // 채팅 목록의 unread 를 실제로 계산하려면 읽음 시점이 필요해서 추가했다.
  // 응답 필드는 바뀌지 않는다(unread 는 계약대로 숫자).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS carrot_chat_rooms (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES carrot_products(id) ON DELETE CASCADE,
      buyer_id BIGINT NOT NULL REFERENCES carrot_users(id) ON DELETE CASCADE,
      seller_id BIGINT NOT NULL REFERENCES carrot_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      buyer_last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      seller_last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (product_id, buyer_id)
    );
  `);
  // 이전 실행에서 만들어진 테이블에도 읽음 컬럼을 채워 넣는다(멱등).
  await pool.query(`ALTER TABLE carrot_chat_rooms ADD COLUMN IF NOT EXISTS buyer_last_read_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await pool.query(`ALTER TABLE carrot_chat_rooms ADD COLUMN IF NOT EXISTS seller_last_read_at TIMESTAMPTZ NOT NULL DEFAULT now();`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carrot_messages (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      room_id BIGINT NOT NULL REFERENCES carrot_chat_rooms(id) ON DELETE CASCADE,
      sender_id BIGINT NOT NULL REFERENCES carrot_users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carrot_reviews (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES carrot_products(id) ON DELETE CASCADE,
      reviewer_id BIGINT NOT NULL REFERENCES carrot_users(id) ON DELETE CASCADE,
      target_id BIGINT NOT NULL REFERENCES carrot_users(id) ON DELETE CASCADE,
      score SMALLINT NOT NULL,
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (product_id, reviewer_id)
    );
  `);

  // 목록 정렬(끌올순), 내 판매내역, 찜목록, 채팅 스크롤에 각각 대응하는 인덱스.
  await pool.query(`CREATE INDEX IF NOT EXISTS carrot_products_bumped_idx ON carrot_products (bumped_at DESC, id DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS carrot_products_seller_idx ON carrot_products (seller_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS carrot_likes_user_idx ON carrot_likes (user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS carrot_messages_room_idx ON carrot_messages (room_id, created_at);`);

  dbInitialized = true;
}

// ------------------------------------------------------------
// Middleware
// images 가 data-URI 배열(최대 3장)이라 body 가 크다 → 12mb.
// ------------------------------------------------------------
app.use(express.json({ limit: '12mb' }));
// dotfiles: 'ignore' 는 express.static 의 기본값이지만, 이 폴더에 JWT_SECRET 이 든 .env 가
// 같이 있으므로 의도를 명시적으로 박아 둔다. GET /.env 는 정적 서빙을 타지 않는다.
app.use(express.static(path.join(__dirname), { dotfiles: 'ignore' }));

// 모든 /api 요청 전에 테이블이 있는지 보장한다.
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init failed:', err.message);
    res.status(500).json({ success: false, message: '데이터베이스 초기화에 실패했습니다.' });
  }
});

// ------------------------------------------------------------
// Auth helpers
// ------------------------------------------------------------
function signToken(user) {
  return jwt.sign({ userId: Number(user.id), email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// DB row → 클라이언트 User JSON. password_hash 는 절대 나가지 않는다.
// manner_temp 는 NUMERIC 이라 pg 가 문자열로 준다 → Number() 로 되돌린다.
function toUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    nickname: row.nickname,
    regionCode: row.region_code,
    regionName: row.region_name,
    regionFullName: row.region_full_name,
    regionRange: Number(row.region_range),
    regionVerifiedAt: row.region_verified_at,
    verifyCount: Number(row.verify_count),
    mannerTemp: Number(row.manner_temp),
    createdAt: row.created_at,
  };
}

async function fetchUserRow(id) {
  const { rows } = await pool.query('SELECT * FROM carrot_users WHERE id = $1', [id]);
  return rows[0] || null;
}

// Bearer 토큰 검증 + 사용자 행 로드 → req.me (DB row).
// 대부분의 라우트가 내 동네 좌표/반경을 필요로 하므로 여기서 한 번에 읽는다.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
  let payload;
  try {
    payload = jwt.verify(match[1].trim(), JWT_SECRET);
  } catch (_err) {
    // 만료/위조/형식오류를 전부 같은 401 로 처리한다.
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
  try {
    const me = await fetchUserRow(payload.userId);
    if (!me) {
      return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
    req.me = me;
    next();
  } catch (err) {
    console.error('requireAuth:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
}

// URL 파라미터를 양의 정수로 파싱. 아니면 res 로 400 후 null.
function readIdParam(req, res, key, label) {
  const id = Number(req.params[key]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, message: `잘못된 ${label} 번호입니다.` });
    return null;
  }
  return id;
}

// ------------------------------------------------------------
// 상품 직렬화
// ------------------------------------------------------------

// pg 는 JSONB 를 이미 파싱된 배열로 준다 → 다시 JSON.parse 하지 않는다.
function imagesOf(row) {
  return Array.isArray(row.images) ? row.images : [];
}

// ProductCard (목록용). SPEC 5절.
function toCard(row, meId) {
  const images = imagesOf(row);
  return {
    id: Number(row.id),
    title: row.title,
    price: Number(row.price),
    category: row.category,
    status: row.status,
    thumbnail: images.length > 0 ? images[0] : null,
    regionName: row.region_name,
    distanceText: formatDistance(row.distance_m),
    likeCount: Number(row.like_count || 0),
    chatCount: Number(row.chat_count || 0),
    viewCount: Number(row.view_count),
    isLiked: row.is_liked === true,
    isMine: Number(row.seller_id) === Number(meId),
    bumpedAt: row.bumped_at,
    createdAt: row.created_at,
  };
}

// ProductDetail = ProductCard + description/images/updatedAt/seller/myChatRoomId.
function toDetail(row, meId) {
  return {
    ...toCard(row, meId),
    description: row.description,
    images: imagesOf(row),
    updatedAt: row.updated_at,
    seller: {
      id: Number(row.seller_id),
      nickname: row.seller_nickname,
      regionName: row.seller_region_name,
      mannerTemp: Number(row.seller_manner_temp),
      verifyCount: Number(row.seller_verify_count),
    },
    myChatRoomId: row.my_chat_room_id == null ? null : Number(row.my_chat_room_id),
  };
}

// 상세/변경 응답에 쓰는 공통 조회. 내 기준 거리·찜여부·집계까지 한 번에 가져온다.
const DETAIL_SQL = `
  SELECT p.*,
         (6371000 * acos(LEAST(1, GREATEST(-1,
            cos(radians($2)) * cos(radians(p.lat)) * cos(radians(p.lng) - radians($3))
            + sin(radians($2)) * sin(radians(p.lat))
         )))) AS distance_m,
         u.nickname AS seller_nickname,
         u.region_name AS seller_region_name,
         u.manner_temp AS seller_manner_temp,
         u.verify_count AS seller_verify_count,
         (SELECT COUNT(*) FROM carrot_likes l WHERE l.product_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM carrot_chat_rooms c WHERE c.product_id = p.id) AS chat_count,
         EXISTS (SELECT 1 FROM carrot_likes l2 WHERE l2.product_id = p.id AND l2.user_id = $4) AS is_liked,
         (SELECT c2.id FROM carrot_chat_rooms c2 WHERE c2.product_id = p.id AND c2.buyer_id = $4) AS my_chat_room_id
  FROM carrot_products p
  JOIN carrot_users u ON u.id = p.seller_id
  WHERE p.id = $1
`;

async function loadDetail(productId, me) {
  const { rows } = await pool.query(DETAIL_SQL, [productId, me.region_lat, me.region_lng, me.id]);
  return rows[0] || null;
}

// ============================================================
// 위치 (토큰 불필요)
// ============================================================

// 가입 전 동네 미리보기 — 좌표를 주면 가장 가까운 동과 후보들을 돌려준다.
app.post('/api/location/resolve', (req, res) => {
  try {
    const coords = readLatLng(req, res);
    if (coords == null) return;

    const resolved = resolveRegion(coords.lat, coords.lng, res);
    if (resolved == null) return;

    const { nearest, ranked } = resolved;
    res.json({
      success: true,
      data: {
        region: { code: nearest.code, name: nearest.name, fullName: nearest.fullName, lat: nearest.lat, lng: nearest.lng },
        distanceM: nearest.distanceM,
        // 가장 가까운 동을 뺀 차순위 후보 5개(8km 안에서만).
        nearby: ranked
          .slice(1)
          .filter((r) => r.distanceM <= MAX_VERIFY_DISTANCE_M)
          .slice(0, 5)
          .map((r) => ({ code: r.code, name: r.name, fullName: r.fullName, lat: r.lat, lng: r.lng, distanceM: r.distanceM })),
      },
    });
  } catch (err) {
    console.error('POST /api/location/resolve:', err.message);
    res.status(500).json({ success: false, message: '위치를 확인하지 못했습니다.' });
  }
});

// ============================================================
// 인증 (토큰 불필요)
// ============================================================

// 회원가입 — 위치인증이 필수다. 동네는 서버가 좌표로 판정해서 박는다.
app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = (req.body && typeof req.body.email === 'string') ? req.body.email.trim().toLowerCase() : '';
    const password = (req.body && typeof req.body.password === 'string') ? req.body.password : '';
    const nickname = (req.body && typeof req.body.nickname === 'string') ? req.body.nickname.trim() : '';

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: '올바른 이메일 형식이 아닙니다.' });
    }
    if (password.length < PASSWORD_MIN) {
      return res.status(400).json({ success: false, message: `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.` });
    }
    if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
      return res.status(400).json({ success: false, message: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자여야 합니다.` });
    }

    const coords = readLatLng(req, res);
    if (coords == null) return;
    const resolved = resolveRegion(coords.lat, coords.lng, res);
    if (resolved == null) return;
    const region = resolved.nearest;

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO carrot_users
           (email, password_hash, nickname, region_code, region_name, region_full_name, region_lat, region_lng)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [email, passwordHash, nickname, region.code, region.name, region.fullName, region.lat, region.lng]
      ));
    } catch (err) {
      // 23505 = unique_violation -> 이미 가입된 이메일.
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: '이미 가입된 이메일입니다.' });
      }
      throw err;
    }

    const user = rows[0];
    res.status(201).json({ success: true, data: { token: signToken(user), user: toUser(user) } });
  } catch (err) {
    console.error('POST /api/auth/signup:', err.message);
    res.status(500).json({ success: false, message: '회원가입에 실패했습니다.' });
  }
});

// 로그인 — 실패 사유(이메일 없음 / 비번 틀림)를 구분하지 않는다(계정 존재 여부 노출 방지).
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = (req.body && typeof req.body.email === 'string') ? req.body.email.trim().toLowerCase() : '';
    const password = (req.body && typeof req.body.password === 'string') ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요.' });
    }

    const { rows } = await pool.query('SELECT * FROM carrot_users WHERE email = $1', [email]);
    const user = rows[0];
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!ok) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    res.json({ success: true, data: { token: signToken(user), user: toUser(user) } });
  } catch (err) {
    console.error('POST /api/auth/login:', err.message);
    res.status(500).json({ success: false, message: '로그인에 실패했습니다.' });
  }
});

// ============================================================
// 내 정보 (토큰 필요)
// ============================================================

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, data: { user: toUser(req.me) } });
});

// 닉네임 / 동네 범위(1~4) 변경.
app.patch('/api/me', requireAuth, async (req, res) => {
  try {
    const sets = [];
    const params = [];

    if (req.body && req.body.nickname !== undefined) {
      const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
      if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
        return res.status(400).json({ success: false, message: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자여야 합니다.` });
      }
      params.push(nickname);
      sets.push(`nickname = $${params.length}`);
    }

    if (req.body && req.body.regionRange !== undefined) {
      const range = Number(req.body.regionRange);
      if (!Number.isInteger(range) || range < 1 || range > 4) {
        return res.status(400).json({ success: false, message: '동네 범위는 1~4 사이여야 합니다.' });
      }
      params.push(range);
      sets.push(`region_range = $${params.length}`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: '변경할 내용이 없습니다.' });
    }

    params.push(req.me.id);
    const { rows } = await pool.query(
      `UPDATE carrot_users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ success: true, data: { user: toUser(rows[0]) } });
  } catch (err) {
    console.error('PATCH /api/me:', err.message);
    res.status(500).json({ success: false, message: '내 정보를 수정하지 못했습니다.' });
  }
});

// 동네 재인증/변경 — verify_count += 1, region_verified_at = now().
app.post('/api/me/verify-location', requireAuth, async (req, res) => {
  try {
    const coords = readLatLng(req, res);
    if (coords == null) return;
    const resolved = resolveRegion(coords.lat, coords.lng, res);
    if (resolved == null) return;
    const region = resolved.nearest;

    const { rows } = await pool.query(
      `UPDATE carrot_users
       SET region_code = $1, region_name = $2, region_full_name = $3,
           region_lat = $4, region_lng = $5,
           region_verified_at = now(), verify_count = verify_count + 1
       WHERE id = $6
       RETURNING *`,
      [region.code, region.name, region.fullName, region.lat, region.lng, req.me.id]
    );

    res.json({
      success: true,
      data: {
        user: toUser(rows[0]),
        region: { code: region.code, name: region.name, fullName: region.fullName, lat: region.lat, lng: region.lng },
        distanceM: region.distanceM,
      },
    });
  } catch (err) {
    console.error('POST /api/me/verify-location:', err.message);
    res.status(500).json({ success: false, message: '동네 인증에 실패했습니다.' });
  }
});

// ============================================================
// 상품 (토큰 필요)
// ============================================================

// 목록 — scope=near(기본)|mine|liked, q, category, status, sort, page, limit.
app.get('/api/products', requireAuth, async (req, res) => {
  try {
    const me = req.me;

    const scope = ['near', 'mine', 'liked'].includes(req.query.scope) ? req.query.scope : 'near';
    const sort = ['recent', 'price_asc', 'price_desc'].includes(req.query.sort) ? req.query.sort : 'recent';

    const category = typeof req.query.category === 'string' && req.query.category.trim() ? req.query.category.trim() : '';
    if (category && !CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: '알 수 없는 카테고리입니다.' });
    }
    const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : '';
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: '알 수 없는 상태입니다.' });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(PAGE_LIMIT_MAX, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    // $n 을 순서대로 붙여 주는 헬퍼. 사용자 입력은 전부 이걸로만 들어간다(SQL injection 방지).
    const params = [];
    const P = (v) => { params.push(v); return `$${params.length}`; };

    const latP = P(me.region_lat);
    const lngP = P(me.region_lng);
    const meP = P(me.id);

    const where = [];
    if (scope === 'mine') {
      where.push(`p.seller_id = ${meP}`);
    } else if (scope === 'liked') {
      where.push(`EXISTS (SELECT 1 FROM carrot_likes l WHERE l.product_id = p.id AND l.user_id = ${meP})`);
    }
    if (category) where.push(`p.category = ${P(category)}`);
    if (status) where.push(`p.status = ${P(status)}`);

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      // LIKE 메타문자(% _ \)를 이스케이프해서 검색어를 리터럴로 취급한다.
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const likeP = P(like);
      where.push(`(p.title ILIKE ${likeP} ESCAPE '\\' OR p.description ILIKE ${likeP} ESCAPE '\\')`);
    }

    // near 는 내 동네 중심에서 regionRange 반경 안의 상품만.
    const radiusM = RANGE_KM[Number(me.region_range) - 1] * 1000;
    const outerWhere = scope === 'near' ? `WHERE b.distance_m <= ${P(radiusM)}` : '';

    // ORDER BY 는 화이트리스트로만 만든다(사용자 입력을 직접 넣지 않는다).
    const orderBy = {
      recent: 'b.bumped_at DESC, b.id DESC',
      price_asc: 'b.price ASC, b.id DESC',
      price_desc: 'b.price DESC, b.id DESC',
    }[sort];

    const limitP = P(limit);
    const offsetP = P(offset);

    // COUNT(*) OVER() 는 WHERE 이후 LIMIT 이전에 계산되므로 필터된 전체 건수를 준다.
    const sql = `
      SELECT b.*,
             COUNT(*) OVER() AS total_count,
             (SELECT COUNT(*) FROM carrot_likes l WHERE l.product_id = b.id) AS like_count,
             (SELECT COUNT(*) FROM carrot_chat_rooms c WHERE c.product_id = b.id) AS chat_count,
             EXISTS (SELECT 1 FROM carrot_likes l2 WHERE l2.product_id = b.id AND l2.user_id = ${meP}) AS is_liked
      FROM (
        SELECT p.*,
               (6371000 * acos(LEAST(1, GREATEST(-1,
                  cos(radians(${latP})) * cos(radians(p.lat)) * cos(radians(p.lng) - radians(${lngP}))
                  + sin(radians(${latP})) * sin(radians(p.lat))
               )))) AS distance_m
        FROM carrot_products p
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ) b
      ${outerWhere}
      ORDER BY ${orderBy}
      LIMIT ${limitP} OFFSET ${offsetP}
    `;

    const { rows } = await pool.query(sql, params);
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

    res.json({
      success: true,
      data: {
        items: rows.map((r) => toCard(r, me.id)),
        page,
        hasMore: offset + rows.length < total,
        total,
      },
    });
  } catch (err) {
    console.error('GET /api/products:', err.message);
    res.status(500).json({ success: false, message: '상품 목록을 불러오지 못했습니다.' });
  }
});

// 상품 입력 검증. mode='create' 면 필수, 'patch' 면 들어온 필드만 본다.
// 통과하면 { fields: {...} }, 아니면 res 로 400 후 null.
function readProductBody(req, res, mode) {
  const body = req.body || {};
  const fields = {};
  const has = (k) => body[k] !== undefined;

  if (mode === 'create' || has('title')) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      res.status(400).json({ success: false, message: '제목을 입력해주세요.' });
      return null;
    }
    if (title.length > TITLE_MAX) {
      res.status(400).json({ success: false, message: `제목은 ${TITLE_MAX}자 이하여야 합니다.` });
      return null;
    }
    fields.title = title;
  }

  if (mode === 'create' || has('description')) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description) {
      res.status(400).json({ success: false, message: '상품 설명을 입력해주세요.' });
      return null;
    }
    if (description.length > DESC_MAX) {
      res.status(400).json({ success: false, message: `상품 설명은 ${DESC_MAX}자 이하여야 합니다.` });
      return null;
    }
    fields.description = description;
  }

  if (mode === 'create' || has('price')) {
    const price = Number(body.price);
    if (!Number.isInteger(price) || price < 0 || price > PRICE_MAX) {
      res.status(400).json({ success: false, message: '가격은 0 이상의 정수여야 합니다.' });
      return null;
    }
    fields.price = price;
  }

  if (mode === 'create' || has('category')) {
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    if (!CATEGORIES.includes(category)) {
      res.status(400).json({ success: false, message: '카테고리를 선택해주세요.' });
      return null;
    }
    fields.category = category;
  }

  if (mode === 'create' || has('images')) {
    const images = body.images === undefined || body.images === null ? [] : body.images;
    if (!Array.isArray(images)) {
      res.status(400).json({ success: false, message: '이미지 형식이 올바르지 않습니다.' });
      return null;
    }
    if (images.length > IMAGES_MAX) {
      res.status(400).json({ success: false, message: `이미지는 최대 ${IMAGES_MAX}장까지 올릴 수 있습니다.` });
      return null;
    }
    for (const img of images) {
      if (typeof img !== 'string' || !img) {
        res.status(400).json({ success: false, message: '이미지 형식이 올바르지 않습니다.' });
        return null;
      }
      if (img.length > IMAGE_CHARS_MAX) {
        res.status(400).json({ success: false, message: '이미지 용량이 너무 큽니다. 더 작게 줄여주세요.' });
        return null;
      }
      if (!/^(data:image\/|https?:\/\/)/.test(img)) {
        res.status(400).json({ success: false, message: '이미지 형식이 올바르지 않습니다.' });
        return null;
      }
    }
    fields.images = images;
  }

  if (has('status')) {
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    if (!STATUSES.includes(status)) {
      res.status(400).json({ success: false, message: '알 수 없는 상태입니다.' });
      return null;
    }
    fields.status = status;
  }

  return fields;
}

// 등록 — 판매자와 위치는 토큰의 내 인증 동네로 서버가 박는다.
// 클라이언트가 보낸 sellerId / lat / lng 는 읽지도 않는다.
app.post('/api/products', requireAuth, async (req, res) => {
  try {
    const fields = readProductBody(req, res, 'create');
    if (fields == null) return;

    const me = req.me;
    const { rows } = await pool.query(
      `INSERT INTO carrot_products
         (seller_id, title, description, price, category, images,
          region_code, region_name, region_full_name, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        me.id, fields.title, fields.description, fields.price, fields.category,
        JSON.stringify(fields.images || []),
        me.region_code, me.region_name, me.region_full_name, me.region_lat, me.region_lng,
      ]
    );

    const detail = await loadDetail(Number(rows[0].id), me);
    res.status(201).json({ success: true, data: { product: toDetail(detail, me.id) } });
  } catch (err) {
    console.error('POST /api/products:', err.message);
    res.status(500).json({ success: false, message: '상품을 등록하지 못했습니다.' });
  }
});

// 상세 — 조회수 +1 (내 글이면 증가시키지 않는다).
app.get('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const id = readIdParam(req, res, 'id', '상품');
    if (id == null) return;

    // 내 글이 아닐 때만 조회수를 올린다. 올린 뒤 상세를 읽어 최신 값을 내보낸다.
    await pool.query(
      'UPDATE carrot_products SET view_count = view_count + 1 WHERE id = $1 AND seller_id <> $2',
      [id, req.me.id]
    );

    const detail = await loadDetail(id, req.me);
    if (!detail) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: { product: toDetail(detail, req.me.id) } });
  } catch (err) {
    console.error('GET /api/products/:id:', err.message);
    res.status(500).json({ success: false, message: '상품을 불러오지 못했습니다.' });
  }
});

// 변경 쿼리가 0행을 돌려줬을 때 원인을 가려낸다: 없으면 404, 남의 글이면 403.
// 응답을 보냈으면 true 를 돌려준다(호출부는 거기서 return).
// 변경 쿼리 자체에는 항상 WHERE seller_id = 나 가 들어가므로, 이건 상태코드를 위한 사후 진단일 뿐이다.
async function respondOwnershipFailure(productId, meId, res) {
  const { rows } = await pool.query('SELECT seller_id FROM carrot_products WHERE id = $1', [productId]);
  if (rows.length === 0) {
    res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    return true;
  }
  if (Number(rows[0].seller_id) !== Number(meId)) {
    res.status(403).json({ success: false, message: '내 상품만 수정할 수 있습니다.' });
    return true;
  }
  return false; // 존재하고 내 글이다 → 다른 이유(쿨다운/이미 판매완료)로 실패한 것.
}

// 수정 — 본인 글만(SQL 에 WHERE seller_id = 나).
app.patch('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const id = readIdParam(req, res, 'id', '상품');
    if (id == null) return;

    const fields = readProductBody(req, res, 'patch');
    if (fields == null) return;
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, message: '변경할 내용이 없습니다.' });
    }

    const sets = [];
    const params = [];
    const push = (frag, value) => { params.push(value); sets.push(frag.replace('$?', `$${params.length}`)); };

    if (fields.title !== undefined) push('title = $?', fields.title);
    if (fields.description !== undefined) push('description = $?', fields.description);
    if (fields.price !== undefined) push('price = $?', fields.price);
    if (fields.category !== undefined) push('category = $?', fields.category);
    if (fields.images !== undefined) push('images = $?::jsonb', JSON.stringify(fields.images));
    if (fields.status !== undefined) {
      push('status = $?', fields.status);
      // 'sold' 를 해제하면 거래상대 기록도 같이 지운다(후기 대상이 어긋나지 않게).
      if (fields.status !== 'sold') sets.push('buyer_id = NULL');
    }
    sets.push('updated_at = now()');

    params.push(id);
    const idP = `$${params.length}`;
    params.push(req.me.id);
    const meP = `$${params.length}`;

    const { rows } = await pool.query(
      `UPDATE carrot_products SET ${sets.join(', ')} WHERE id = ${idP} AND seller_id = ${meP} RETURNING id`,
      params
    );
    if (rows.length === 0) {
      if (await respondOwnershipFailure(id, req.me.id, res)) return;
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    const detail = await loadDetail(id, req.me);
    res.json({ success: true, data: { product: toDetail(detail, req.me.id) } });
  } catch (err) {
    console.error('PATCH /api/products/:id:', err.message);
    res.status(500).json({ success: false, message: '상품을 수정하지 못했습니다.' });
  }
});

// 삭제 — 본인 글만.
app.delete('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const id = readIdParam(req, res, 'id', '상품');
    if (id == null) return;

    const { rows } = await pool.query(
      'DELETE FROM carrot_products WHERE id = $1 AND seller_id = $2 RETURNING id',
      [id, req.me.id]
    );
    if (rows.length === 0) {
      if (await respondOwnershipFailure(id, req.me.id, res)) return;
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: { id } });
  } catch (err) {
    console.error('DELETE /api/products/:id:', err.message);
    res.status(500).json({ success: false, message: '상품을 삭제하지 못했습니다.' });
  }
});

// 끌어올리기 — 본인 글만. 마지막 끌올 후 1시간 이내면 400.
app.post('/api/products/:id/bump', requireAuth, async (req, res) => {
  try {
    const id = readIdParam(req, res, 'id', '상품');
    if (id == null) return;

    const { rows } = await pool.query(
      `UPDATE carrot_products SET bumped_at = now(), updated_at = now()
       WHERE id = $1 AND seller_id = $2 AND bumped_at <= now() - interval '1 hour'
       RETURNING id`,
      [id, req.me.id]
    );
    if (rows.length === 0) {
      // 404(없음) / 403(남의 글) 을 먼저 걸러내고, 둘 다 아니면 쿨다운이다.
      if (await respondOwnershipFailure(id, req.me.id, res)) return;
      return res.status(400).json({ success: false, message: '끌어올리기는 1시간에 한 번만 할 수 있습니다.' });
    }

    const detail = await loadDetail(id, req.me);
    res.json({ success: true, data: { product: toDetail(detail, req.me.id) } });
  } catch (err) {
    console.error('POST /api/products/:id/bump:', err.message);
    res.status(500).json({ success: false, message: '끌어올리지 못했습니다.' });
  }
});

// 찜하기 — 내 상품은 찜할 수 없다.
app.post('/api/products/:id/like', requireAuth, async (req, res) => {
  try {
    const id = readIdParam(req, res, 'id', '상품');
    if (id == null) return;

    const { rows: prod } = await pool.query('SELECT seller_id FROM carrot_products WHERE id = $1', [id]);
    if (prod.length === 0) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }
    if (Number(prod[0].seller_id) === Number(req.me.id)) {
      return res.status(400).json({ success: false, message: '내 상품은 찜할 수 없습니다.' });
    }

    // 이미 찜했으면 조용히 넘어간다(연타해도 안전).
    await pool.query(
      'INSERT INTO carrot_likes (product_id, user_id) VALUES ($1, $2) ON CONFLICT (product_id, user_id) DO NOTHING',
      [id, req.me.id]
    );
    const { rows } = await pool.query('SELECT COUNT(*) AS n FROM carrot_likes WHERE product_id = $1', [id]);
    res.json({ success: true, data: { liked: true, likeCount: Number(rows[0].n) } });
  } catch (err) {
    console.error('POST /api/products/:id/like:', err.message);
    res.status(500).json({ success: false, message: '찜하지 못했습니다.' });
  }
});

// 찜 해제.
app.delete('/api/products/:id/like', requireAuth, async (req, res) => {
  try {
    const id = readIdParam(req, res, 'id', '상품');
    if (id == null) return;

    await pool.query('DELETE FROM carrot_likes WHERE product_id = $1 AND user_id = $2', [id, req.me.id]);
    const { rows } = await pool.query('SELECT COUNT(*) AS n FROM carrot_likes WHERE product_id = $1', [id]);
    res.json({ success: true, data: { liked: false, likeCount: Number(rows[0].n) } });
  } catch (err) {
    console.error('DELETE /api/products/:id/like:', err.message);
    res.status(500).json({ success: false, message: '찜을 해제하지 못했습니다.' });
  }
});

// 거래완료 — 판매자만. buyerId 를 거래상대로 기록한다.
app.post('/api/products/:id/complete', requireAuth, async (req, res) => {
  try {
    const id = readIdParam(req, res, 'id', '상품');
    if (id == null) return;

    const buyerId = Number(req.body && req.body.buyerId);
    if (!Number.isInteger(buyerId) || buyerId <= 0) {
      return res.status(400).json({ success: false, message: '거래한 상대를 선택해주세요.' });
    }
    if (buyerId === Number(req.me.id)) {
      return res.status(400).json({ success: false, message: '자기 자신과는 거래할 수 없습니다.' });
    }

    const { rows: buyer } = await pool.query('SELECT id FROM carrot_users WHERE id = $1', [buyerId]);
    if (buyer.length === 0) {
      return res.status(404).json({ success: false, message: '거래 상대를 찾을 수 없습니다.' });
    }

    const { rows } = await pool.query(
      `UPDATE carrot_products SET status = 'sold', buyer_id = $3, updated_at = now()
       WHERE id = $1 AND seller_id = $2 AND status <> 'sold'
       RETURNING id`,
      [id, req.me.id, buyerId]
    );
    if (rows.length === 0) {
      if (await respondOwnershipFailure(id, req.me.id, res)) return;
      return res.status(400).json({ success: false, message: '이미 거래완료된 상품입니다.' });
    }

    const detail = await loadDetail(id, req.me);
    res.json({ success: true, data: { product: toDetail(detail, req.me.id) } });
  } catch (err) {
    console.error('POST /api/products/:id/complete:', err.message);
    res.status(500).json({ success: false, message: '거래완료 처리에 실패했습니다.' });
  }
});

// ============================================================
// 채팅 (토큰 필요)
// ============================================================

// 내가 낀 방 목록. 마지막 메시지 시각 기준 최신순.
app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    const meId = req.me.id;
    const { rows } = await pool.query(
      `SELECT r.id, r.product_id, r.buyer_id, r.seller_id, r.created_at,
              p.title, p.price, p.status, p.images,
              u.id AS peer_id, u.nickname AS peer_nickname, u.manner_temp AS peer_manner_temp,
              m.body AS last_message,
              COALESCE(m.created_at, r.created_at) AS last_at,
              (SELECT COUNT(*) FROM carrot_messages m2
                WHERE m2.room_id = r.id
                  AND m2.sender_id <> $1
                  AND m2.created_at > CASE WHEN r.buyer_id = $1 THEN r.buyer_last_read_at ELSE r.seller_last_read_at END
              ) AS unread
       FROM carrot_chat_rooms r
       JOIN carrot_products p ON p.id = r.product_id
       JOIN carrot_users u ON u.id = CASE WHEN r.buyer_id = $1 THEN r.seller_id ELSE r.buyer_id END
       LEFT JOIN LATERAL (
         SELECT body, created_at FROM carrot_messages
         WHERE room_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1
       ) m ON true
       WHERE r.buyer_id = $1 OR r.seller_id = $1
       ORDER BY last_at DESC, r.id DESC`,
      [meId]
    );

    res.json({
      success: true,
      data: {
        items: rows.map((r) => {
          const images = Array.isArray(r.images) ? r.images : [];
          return {
            id: Number(r.id),
            product: {
              id: Number(r.product_id),
              title: r.title,
              thumbnail: images.length > 0 ? images[0] : null,
              price: Number(r.price),
              status: r.status,
            },
            peer: {
              id: Number(r.peer_id),
              nickname: r.peer_nickname,
              mannerTemp: Number(r.peer_manner_temp),
            },
            lastMessage: r.last_message === null ? null : r.last_message,
            lastAt: r.last_at,
            unread: Number(r.unread),
          };
        }),
      },
    });
  } catch (err) {
    console.error('GET /api/chats:', err.message);
    res.status(500).json({ success: false, message: '채팅 목록을 불러오지 못했습니다.' });
  }
});

// 방 생성 또는 기존 방 반환. 내 상품에는 방을 만들 수 없다.
app.post('/api/chats', requireAuth, async (req, res) => {
  try {
    const productId = Number(req.body && req.body.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ success: false, message: '잘못된 상품 번호입니다.' });
    }

    const { rows: prod } = await pool.query('SELECT id, seller_id FROM carrot_products WHERE id = $1', [productId]);
    if (prod.length === 0) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }
    const sellerId = Number(prod[0].seller_id);
    if (sellerId === Number(req.me.id)) {
      return res.status(400).json({ success: false, message: '내 상품에는 채팅을 걸 수 없습니다.' });
    }

    // 같은 (상품, 구매자) 조합은 방이 하나뿐이다 — 있으면 그 방을 돌려준다.
    const { rows } = await pool.query(
      `INSERT INTO carrot_chat_rooms (product_id, buyer_id, seller_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (product_id, buyer_id) DO UPDATE SET product_id = EXCLUDED.product_id
       RETURNING id, product_id, buyer_id, seller_id, created_at`,
      [productId, req.me.id, sellerId]
    );
    const room = rows[0];

    res.status(201).json({
      success: true,
      data: {
        room: {
          id: Number(room.id),
          productId: Number(room.product_id),
          buyerId: Number(room.buyer_id),
          sellerId: Number(room.seller_id),
          createdAt: room.created_at,
        },
      },
    });
  } catch (err) {
    console.error('POST /api/chats:', err.message);
    res.status(500).json({ success: false, message: '채팅방을 열지 못했습니다.' });
  }
});

// 방을 읽고 참여자인지 확인한다. 참여자가 아니면 res 로 403/404 후 null.
async function loadRoomAsParticipant(roomId, meId, res) {
  const { rows } = await pool.query(
    `SELECT r.*, p.title, p.price, p.status, p.images
     FROM carrot_chat_rooms r
     JOIN carrot_products p ON p.id = r.product_id
     WHERE r.id = $1`,
    [roomId]
  );
  if (rows.length === 0) {
    res.status(404).json({ success: false, message: '채팅방을 찾을 수 없습니다.' });
    return null;
  }
  const room = rows[0];
  if (Number(room.buyer_id) !== Number(meId) && Number(room.seller_id) !== Number(meId)) {
    res.status(403).json({ success: false, message: '이 채팅방에 접근할 수 없습니다.' });
    return null;
  }
  return room;
}

// 메시지 목록 — 참여자만. 읽는 순간 내 last_read 를 갱신한다(unread 계산용).
app.get('/api/chats/:roomId/messages', requireAuth, async (req, res) => {
  try {
    const roomId = readIdParam(req, res, 'roomId', '채팅방');
    if (roomId == null) return;

    const room = await loadRoomAsParticipant(roomId, req.me.id, res);
    if (room == null) return;

    const isBuyer = Number(room.buyer_id) === Number(req.me.id);
    const peerId = isBuyer ? room.seller_id : room.buyer_id;

    const { rows: messages } = await pool.query(
      'SELECT id, sender_id, body, created_at FROM carrot_messages WHERE room_id = $1 ORDER BY created_at ASC, id ASC',
      [roomId]
    );
    const { rows: peerRows } = await pool.query(
      'SELECT id, nickname, manner_temp FROM carrot_users WHERE id = $1',
      [peerId]
    );

    // 읽음 처리 — 다음 목록 조회부터 unread 가 0 이 된다.
    await pool.query(
      `UPDATE carrot_chat_rooms
       SET ${isBuyer ? 'buyer_last_read_at' : 'seller_last_read_at'} = now()
       WHERE id = $1`,
      [roomId]
    );

    const images = Array.isArray(room.images) ? room.images : [];
    const peer = peerRows[0];

    res.json({
      success: true,
      data: {
        items: messages.map((m) => ({
          id: Number(m.id),
          senderId: Number(m.sender_id),
          body: m.body,
          createdAt: m.created_at,
          isMine: Number(m.sender_id) === Number(req.me.id),
        })),
        product: {
          id: Number(room.product_id),
          title: room.title,
          thumbnail: images.length > 0 ? images[0] : null,
          price: Number(room.price),
          status: room.status,
        },
        peer: peer
          ? { id: Number(peer.id), nickname: peer.nickname, mannerTemp: Number(peer.manner_temp) }
          : null,
      },
    });
  } catch (err) {
    console.error('GET /api/chats/:roomId/messages:', err.message);
    res.status(500).json({ success: false, message: '메시지를 불러오지 못했습니다.' });
  }
});

// 메시지 전송 — 참여자만.
app.post('/api/chats/:roomId/messages', requireAuth, async (req, res) => {
  try {
    const roomId = readIdParam(req, res, 'roomId', '채팅방');
    if (roomId == null) return;

    const body = (req.body && typeof req.body.body === 'string') ? req.body.body.trim() : '';
    if (!body) {
      return res.status(400).json({ success: false, message: '메시지를 입력해주세요.' });
    }
    if (body.length > MESSAGE_MAX) {
      return res.status(400).json({ success: false, message: `메시지는 ${MESSAGE_MAX}자 이하여야 합니다.` });
    }

    const room = await loadRoomAsParticipant(roomId, req.me.id, res);
    if (room == null) return;

    const { rows } = await pool.query(
      'INSERT INTO carrot_messages (room_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, sender_id, body, created_at',
      [roomId, req.me.id, body]
    );
    const m = rows[0];

    res.status(201).json({
      success: true,
      data: {
        message: {
          id: Number(m.id),
          senderId: Number(m.sender_id),
          body: m.body,
          createdAt: m.created_at,
          isMine: true,
        },
      },
    });
  } catch (err) {
    console.error('POST /api/chats/:roomId/messages:', err.message);
    res.status(500).json({ success: false, message: '메시지를 보내지 못했습니다.' });
  }
});

// ============================================================
// 후기 (토큰 필요)
// ============================================================

// 거래완료된 상품의 당사자(판매자 ↔ 구매자)끼리만. 상대 매너온도를 score*0.5 만큼 조정.
app.post('/api/reviews', requireAuth, async (req, res) => {
  try {
    const productId = Number(req.body && req.body.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ success: false, message: '잘못된 상품 번호입니다.' });
    }

    const score = Number(req.body && req.body.score);
    if (![-1, 0, 1].includes(score)) {
      return res.status(400).json({ success: false, message: '평가는 -1, 0, 1 중 하나여야 합니다.' });
    }

    const comment = (req.body && typeof req.body.comment === 'string') ? req.body.comment.trim() : '';
    if (comment.length > COMMENT_MAX) {
      return res.status(400).json({ success: false, message: `후기는 ${COMMENT_MAX}자 이하여야 합니다.` });
    }

    const { rows: prod } = await pool.query(
      'SELECT id, seller_id, buyer_id, status FROM carrot_products WHERE id = $1',
      [productId]
    );
    if (prod.length === 0) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }
    const p = prod[0];
    if (p.status !== 'sold' || p.buyer_id == null) {
      return res.status(400).json({ success: false, message: '거래완료된 상품에만 후기를 쓸 수 있습니다.' });
    }

    // 리뷰어가 판매자면 대상은 구매자, 구매자면 대상은 판매자. 둘 다 아니면 남의 거래다.
    const meId = Number(req.me.id);
    let targetId = null;
    if (Number(p.seller_id) === meId) targetId = Number(p.buyer_id);
    else if (Number(p.buyer_id) === meId) targetId = Number(p.seller_id);
    if (targetId == null) {
      return res.status(403).json({ success: false, message: '이 거래의 당사자만 후기를 쓸 수 있습니다.' });
    }

    let review;
    try {
      const { rows } = await pool.query(
        `INSERT INTO carrot_reviews (product_id, reviewer_id, target_id, score, comment)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, product_id, reviewer_id, target_id, score, comment, created_at`,
        [productId, meId, targetId, score, comment || null]
      );
      review = rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: '이미 후기를 작성했습니다.' });
      }
      throw err;
    }

    // 매너온도는 0~99 범위로 묶는다.
    const { rows: updated } = await pool.query(
      'UPDATE carrot_users SET manner_temp = LEAST(99, GREATEST(0, manner_temp + $1)) WHERE id = $2 RETURNING manner_temp',
      [score * 0.5, targetId]
    );

    res.status(201).json({
      success: true,
      data: {
        review: {
          id: Number(review.id),
          productId: Number(review.product_id),
          reviewerId: Number(review.reviewer_id),
          targetId: Number(review.target_id),
          score: Number(review.score),
          comment: review.comment,
          createdAt: review.created_at,
        },
        targetMannerTemp: Number(updated[0].manner_temp),
      },
    });
  } catch (err) {
    console.error('POST /api/reviews:', err.message);
    res.status(500).json({ success: false, message: '후기를 등록하지 못했습니다.' });
  }
});

// ------------------------------------------------------------
// Fallbacks
// ------------------------------------------------------------

// 알 수 없는 /api 경로 → HTML 이 아니라 JSON 404.
app.use('/api', (_req, res) => res.status(404).json({ success: false, message: '존재하지 않는 API 경로입니다.' }));

// SPA fallback: /api 가 아닌 GET 은 index.html 로.
// index.html 은 프론트 담당이 만든다 — 아직 없을 수 있으니 에러를 삼키고 안내만 준다.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'), (err) => {
    if (err && !res.headersSent) {
      res.status(404).send('index.html 이 아직 없습니다. (프론트 준비 중)');
    }
  });
});

// 마지막 안전망 — body 파싱 실패/용량 초과도 JSON 으로 돌려준다.
app.use((err, _req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(400).json({ success: false, message: '요청이 너무 큽니다. 이미지 개수나 크기를 줄여주세요.' });
  }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ success: false, message: '요청 형식이 올바르지 않습니다.' });
  }
  console.error('Unhandled error:', err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
});

// ------------------------------------------------------------
// Local: start server. Serverless (Vercel): export app.
// ------------------------------------------------------------
if (require.main === module) {
  // 데모 중 예기치 못한 rejection 하나로 서버가 통째로 죽는 걸 막는다.
  // 삼키지 않고 크게 로그를 남긴다 — 조용히 무시하면 진짜 버그를 놓친다.
  process.on('unhandledRejection', err => {
    console.error('[unhandledRejection] 확인 필요:', err && (err.stack || err.message || err));
  });

  const server = app.listen(PORT, () => {
    console.log(`당근마켓 클론 서버 실행 중: http://localhost:${PORT}`);
  });

  // 포트가 이미 물려 있으면 원인을 알기 쉽게 알려준다(스택 트레이스만 뱉지 않도록).
  server.on('error', err => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`포트 ${PORT} 가 이미 사용 중입니다. 기존 프로세스를 종료한 뒤 다시 실행하세요.`);
      process.exit(1);
    }
    throw err;
  });
}

module.exports = app;
