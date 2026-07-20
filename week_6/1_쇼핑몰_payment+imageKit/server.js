// ============================================================
// 영유아 쇼핑몰 API server (email/password + JWT auth) — 결제 기능 없음
// Express + PostgreSQL (Supabase) — 3-file architecture:
// server.js / index.html (+ package.json)
//
// 데이터 모델:
//   users           : 계정(email/password_hash). 로그인 주체. (인증 공용 테이블)
//   shop_products   : 판매 상품 카탈로그(상품 1개 = 1행). 모든 사용자 공통.
//   shop_cart_items : 사용자별 장바구니 1줄 = 1행. (user_id + product_id 유니크, quantity)
//
// 권한 규칙:
//   - 상품 목록: 로그인 없이 누구나 볼 수 있는 공개 카탈로그.
//   - 장바구니: 로그인(JWT) 필요. 철저히 사용자별 — 내 토큰의 user 것만 읽고/바꾼다.
//
// 공용 Supabase 를 다른 quest 앱과 공유하므로 도메인 테이블명에 shop_ 접두사를 붙여
// 충돌을 피한다. users 는 인증 공용 테이블이라 그대로 둔다(커뮤니티 앱과 공유).
// ============================================================

const path = require('path');
const crypto = require('crypto');

// .env 로드 순서(dotenv 는 이미 설정된 값을 덮어쓰지 않으므로 먼저 로드된 게 우선):
//   1) 앱 로컬 .env  — 이 앱 전용 비밀값(JWT_SECRET, PORT, TOSS_*, IMAGEKIT_*)
//   2) 상위 .env      — 같은 주차 공유값이 있으면(현재 week_6 에는 없음)
//   3) week_5 공유 .env — DATABASE_URL 의 원본. 이 앱은 week_5 Supabase 를 공유하며,
//      week_6 로 복사돼도(상위 .env 부재) DB 접속문자열이 채워지도록 명시적으로 참조한다.
//      Vercel 등 배포 환경에선 process.env.DATABASE_URL 이 이미 세팅돼 이 폴백을 타지 않는다.
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', 'week_5', '.env') });
}

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3004;

// .trim() guards against trailing-newline quirks in platform env vars.
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const SALT_ROUNDS = 10;
const TOKEN_TTL = '7d';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 장바구니 수량 상한(비정상 입력 방지). 프론트 스테퍼와 맞춘다.
const QTY_MAX = 99;

// TossPayments 결제위젯 키. 시크릿키는 서버 전용 — 절대 클라이언트로 내려보내지 않는다.
const TOSS_CLIENT_KEY = (process.env.TOSS_CLIENT_KEY || '').trim();
const TOSS_SECRET_KEY = (process.env.TOSS_SECRET_KEY || '').trim();
const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm';

// ImageKit 프로필 사진 업로드. PRIVATE_KEY 는 서버 전용(업로드 인증 서명 계산에만 사용).
const IMAGEKIT_URL_ENDPOINT = (process.env.IMAGEKIT_URL_ENDPOINT || '').trim();
const IMAGEKIT_PUBLIC_KEY = (process.env.IMAGEKIT_PUBLIC_KEY || '').trim();
const IMAGEKIT_PRIVATE_KEY = (process.env.IMAGEKIT_PRIVATE_KEY || '').trim();

// ------------------------------------------------------------
// PostgreSQL pool (Supabase transaction pooler requires SSL)
// ------------------------------------------------------------
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ------------------------------------------------------------
// 🌱 상품 시드.
// 대표 이미지는 Unsplash 직접 CDN URL — 무료/저작권 표기 불필요, 상업적 사용 가능(Unsplash License).
// emoji 는 이미지 로딩 실패 시 프론트엔드 폴백으로 계속 사용한다.
// [name, description, price(원), category, emoji(폴백), imageUrl]
// ------------------------------------------------------------
const UNSPLASH = (id) => `https://images.unsplash.com/photo-${id}?w=600&q=80&auto=format&fit=crop`;

const SEED_PRODUCTS = [
  ['유기농 쌀미음', '6개월부터, 초기 이유식용 유기농 쌀미음', 8900, '이유식 재료', '🍚', UNSPLASH('1536304993881-ff6e9eefa2a6')],
  ['단호박 큐브', '소분 냉동 단호박 퓨레 큐브 (12개입)', 6500, '이유식 재료', '🎃', UNSPLASH('1533924049770-7c32435557c5')],
  ['소고기 안심 다짐육', '이유식용 1등급 한우 안심 다짐육 100g', 12900, '이유식 재료', '🥩', UNSPLASH('1448907503123-67254d59ca4f')],
  ['브로콜리 퓨레', '유기농 브로콜리 퓨레 파우치', 5900, '이유식 재료', '🥦', UNSPLASH('1685504445355-0e7bdf90d415')],
  ['유기농 바나나', '아이 간식용 친환경 바나나 한 송이', 4200, '간식', '🍌', UNSPLASH('1565804212260-280f967e431b')],
  ['아기 치즈', '나트륨 줄인 유아용 슬라이스 치즈 (10매)', 7800, '간식', '🧀', UNSPLASH('1683314573422-649a3c6ad784')],
  ['쌀과자', '돌 전후 아기용 무첨가 쌀과자', 3900, '간식', '🍘', UNSPLASH('1651793371427-ad065df0d208')],
  ['유아용 요거트', '무가당 플레인 유아 요거트 (4컵)', 5500, '간식', '🥛', UNSPLASH('1571212515416-fef01fc43637')],
  ['기저귀 점보팩', '밴드형 기저귀 점보팩 (소형 80매)', 23900, '물품', '🧷', UNSPLASH('1584839404042-8bc21d240e91')],
  ['아기 물티슈', '엠보싱 아기 물티슈 (캡형 70매 x 3)', 13500, '물품', '🧻', UNSPLASH('1633265484557-e298493cb162')],
  ['유아용 식판', '미끄럼방지 실리콘 유아 식판', 9900, '물품', '🍽️', UNSPLASH('1642379831568-aa4e13c805c1')],
  ['아기 숟가락 세트', 'BPA-free 유아 이유식 숟가락 3종 세트', 6900, '물품', '🥄', UNSPLASH('1760267982929-b038bf9b82e0')],
];

// ------------------------------------------------------------
// Lazy migration + seed: 한 번만 실행. 플래그로 매 요청 재실행을 막는다.
// ------------------------------------------------------------
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;

  // 인증 공용 테이블(커뮤니티 앱과 동일 스키마). 이미 있으면 그대로 둔다.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // 프로필 사진 URL(ImageKit). 공유 users 테이블에 additive 로 컬럼만 보강한다.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_products (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price BIGINT NOT NULL CHECK (price >= 0),
      category TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🛒',
      image_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // 기존 DB(이미지 컬럼 없이 생성·시드된 경우)에 컬럼을 보강한다.
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_cart_items (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
      quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, product_id)
    );
  `);

  // 주문/결제 내역. order_id = 토스에 넘기는 주문번호(유니크). status: pending|paid|failed.
  // items 는 결제 시점의 장바구니 스냅샷(JSONB) — 이후 상품이 바뀌어도 주문내역은 보존.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_orders (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL CHECK (amount >= 0),
      order_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_key TEXT,
      method TEXT,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ
    );
  `);

  // 상품이 하나도 없을 때만 시드(이미 있으면 건너뜀).
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM shop_products');
  if (rows[0].n === 0) {
    // 다중행 INSERT. (6컬럼)씩 ($1..$6),($7..$12)... 형태로 파라미터를 만든다.
    const values = [];
    const params = [];
    SEED_PRODUCTS.forEach((p, i) => {
      const b = i * 6;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
      params.push(p[0], p[1], p[2], p[3], p[4], p[5]);
    });
    await pool.query(
      `INSERT INTO shop_products (name, description, price, category, emoji, image_url) VALUES ${values.join(', ')}`,
      params
    );
  } else {
    // 이미 시드된 기존 행에 이미지/이모지를 이름 기준으로 백필·동기화한다(프로세스당 1회).
    for (const p of SEED_PRODUCTS) {
      await pool.query(
        'UPDATE shop_products SET image_url = $2, emoji = $3 WHERE name = $1',
        [p[0], p[5], p[4]]
      );
    }
  }

  dbInitialized = true;
}

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Ensure tables/seed exist before any /api request is handled.
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
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// Verify the Bearer token, attach req.user = { userId, email }.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
  try {
    const payload = jwt.verify(match[1].trim(), JWT_SECRET);
    req.user = { userId: payload.userId, email: payload.email };
    next();
  } catch (_err) {
    // Covers expired, malformed, and bad-signature tokens alike.
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
}

// 이메일에서 표시용 이름(@ 앞부분). 클라이언트도 같은 규칙.
function displayName(email) {
  return typeof email === 'string' ? email.split('@')[0] : '';
}

// 클라이언트로 내려줄 사용자 객체(비밀번호 해시 제외, 프로필 사진 포함).
function authUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    name: displayName(row.email),
    avatarUrl: row.avatar_url || '',
  };
}

// shop_products row → 클라이언트 Product JSON (숫자는 Number 로).
function toProduct(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    price: Number(row.price),
    category: row.category,
    emoji: row.emoji,
    imageUrl: row.image_url,
  };
}

// ------------------------------------------------------------
// 장바구니 요약(CartSummary) 빌더 — 모든 cart 응답이 이 모양을 돌려준다.
//   { items:[ {productId, name, description, price, category, emoji, quantity, lineTotal} ],
//     totalQuantity, totalAmount }
// 한 번의 JOIN 쿼리로 내 장바구니 전체를 읽어 합계를 계산한다.
// ------------------------------------------------------------
async function getCartSummary(userId) {
  const { rows } = await pool.query(
    `SELECT c.product_id, c.quantity,
            p.name, p.description, p.price, p.category, p.emoji, p.image_url
       FROM shop_cart_items c
       JOIN shop_products p ON p.id = c.product_id
      WHERE c.user_id = $1
      ORDER BY c.created_at ASC, c.id ASC`,
    [userId]
  );

  let totalQuantity = 0;
  let totalAmount = 0;
  const items = rows.map((r) => {
    const price = Number(r.price);
    const quantity = Number(r.quantity);
    const lineTotal = price * quantity;
    totalQuantity += quantity;
    totalAmount += lineTotal;
    return {
      productId: Number(r.product_id),
      name: r.name,
      description: r.description,
      price,
      category: r.category,
      emoji: r.emoji,
      imageUrl: r.image_url,
      quantity,
      lineTotal,
    };
  });

  return { items, totalQuantity, totalAmount };
}

// URL 파라미터 :productId 를 양의 정수로 파싱. 아니면 res 로 400 후 null.
function readProductId(req, res) {
  const id = Number(req.params.productId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, message: '잘못된 상품 번호입니다.' });
    return null;
  }
  return id;
}

// ------------------------------------------------------------
// Auth routes (no token required)
// ------------------------------------------------------------

// Sign up: create a user, return a token.
app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = (req.body && typeof req.body.email === 'string') ? req.body.email.trim().toLowerCase() : '';
    const password = (req.body && typeof req.body.password === 'string') ? req.body.password : '';

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: '올바른 이메일 형식이 아닙니다.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: '비밀번호는 6자 이상이어야 합니다.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    let rows;
    try {
      ({ rows } = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash]
      ));
    } catch (err) {
      // 23505 = unique_violation -> email already registered.
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: '이미 가입된 이메일입니다.' });
      }
      throw err;
    }

    const user = rows[0];
    const token = signToken(user);
    res.status(201).json({
      success: true,
      data: { token, user: authUser(user) },
    });
  } catch (err) {
    console.error('POST /api/auth/signup:', err.message);
    res.status(500).json({ success: false, message: '회원가입에 실패했습니다.' });
  }
});

// Log in: verify credentials, return a token.
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = (req.body && typeof req.body.email === 'string') ? req.body.email.trim().toLowerCase() : '';
    const password = (req.body && typeof req.body.password === 'string') ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요.' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, password_hash, avatar_url FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];

    // 동일한 generic 메시지(unknown email / wrong password) — user enumeration 방지.
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!ok) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = signToken(user);
    res.json({
      success: true,
      data: { token, user: authUser(user) },
    });
  } catch (err) {
    console.error('POST /api/auth/login:', err.message);
    res.status(500).json({ success: false, message: '로그인에 실패했습니다.' });
  }
});

// Current user from the token (프로필 사진 최신값을 위해 DB 조회).
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, avatar_url FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (!rows[0]) {
      return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
    res.json({ success: true, data: { user: authUser(rows[0]) } });
  } catch (err) {
    console.error('GET /api/auth/me:', err.message);
    res.status(500).json({ success: false, message: '사용자 정보를 불러오지 못했습니다.' });
  }
});

// ------------------------------------------------------------
// Product routes (public) — 로그인 없이 볼 수 있는 공개 카탈로그.
// ------------------------------------------------------------
app.get('/api/products', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      // 카테고리 묶음 → 가격 낮은 순 → 이름 순으로 보기 좋게 정렬.
      `SELECT id, name, description, price, category, emoji, image_url
         FROM shop_products
        ORDER BY category ASC, price ASC, name ASC`
    );
    res.json({ success: true, data: rows.map(toProduct) });
  } catch (err) {
    console.error('GET /api/products:', err.message);
    res.status(500).json({ success: false, message: '상품 목록을 불러오지 못했습니다.' });
  }
});

// ------------------------------------------------------------
// Cart routes (auth required, per-user) — 모든 응답은 CartSummary.
// ------------------------------------------------------------

// 내 장바구니 조회.
app.get('/api/cart', requireAuth, async (req, res) => {
  try {
    const summary = await getCartSummary(req.user.userId);
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('GET /api/cart:', err.message);
    res.status(500).json({ success: false, message: '장바구니를 불러오지 못했습니다.' });
  }
});

// 담기 — 이미 담긴 상품이면 수량 누적(upsert). { productId, quantity?=1 }
app.post('/api/cart', requireAuth, async (req, res) => {
  try {
    const productId = Number(req.body && req.body.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ success: false, message: '잘못된 상품 번호입니다.' });
    }

    // quantity 기본 1, 정수, 1..QTY_MAX 로 보정.
    let quantity = req.body && req.body.quantity != null ? Number(req.body.quantity) : 1;
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, message: '수량은 1 이상의 정수여야 합니다.' });
    }
    if (quantity > QTY_MAX) quantity = QTY_MAX;

    // 상품 존재 확인.
    const exists = await pool.query('SELECT 1 FROM shop_products WHERE id = $1', [productId]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, message: '존재하지 않는 상품입니다.' });
    }

    // upsert: 이미 있으면 수량 누적(상한 QTY_MAX 로 클램프).
    await pool.query(
      `INSERT INTO shop_cart_items (user_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = LEAST($4, shop_cart_items.quantity + EXCLUDED.quantity),
                     updated_at = now()`,
      [req.user.userId, productId, quantity, QTY_MAX]
    );

    const summary = await getCartSummary(req.user.userId);
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('POST /api/cart:', err.message);
    res.status(500).json({ success: false, message: '장바구니에 담지 못했습니다.' });
  }
});

// 수량 변경(덮어쓰기) — { quantity } (정수 1..QTY_MAX)
app.patch('/api/cart/:productId', requireAuth, async (req, res) => {
  try {
    const productId = readProductId(req, res);
    if (productId == null) return;

    const quantity = Number(req.body && req.body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ success: false, message: '수량은 1 이상의 정수여야 합니다.' });
    }
    if (quantity > QTY_MAX) {
      return res.status(400).json({ success: false, message: `수량은 ${QTY_MAX}개까지 가능합니다.` });
    }

    const { rows } = await pool.query(
      `UPDATE shop_cart_items SET quantity = $1, updated_at = now()
        WHERE user_id = $2 AND product_id = $3
        RETURNING id`,
      [quantity, req.user.userId, productId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '장바구니에 없는 상품입니다.' });
    }

    const summary = await getCartSummary(req.user.userId);
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('PATCH /api/cart/:productId:', err.message);
    res.status(500).json({ success: false, message: '수량을 변경하지 못했습니다.' });
  }
});

// 한 상품 삭제.
app.delete('/api/cart/:productId', requireAuth, async (req, res) => {
  try {
    const productId = readProductId(req, res);
    if (productId == null) return;

    const { rows } = await pool.query(
      'DELETE FROM shop_cart_items WHERE user_id = $1 AND product_id = $2 RETURNING id',
      [req.user.userId, productId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '장바구니에 없는 상품입니다.' });
    }

    const summary = await getCartSummary(req.user.userId);
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('DELETE /api/cart/:productId:', err.message);
    res.status(500).json({ success: false, message: '상품을 삭제하지 못했습니다.' });
  }
});

// 전체 비우기.
app.delete('/api/cart', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM shop_cart_items WHERE user_id = $1', [req.user.userId]);
    const summary = await getCartSummary(req.user.userId);
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('DELETE /api/cart:', err.message);
    res.status(500).json({ success: false, message: '장바구니를 비우지 못했습니다.' });
  }
});

// ------------------------------------------------------------
// 💳 Payment routes (TossPayments 결제위젯)
//   GET  /api/payments/config  : 공개 — 프론트가 클라이언트키(공개키)를 받아 위젯 초기화
//   POST /api/orders           : (auth) 현재 장바구니로 pending 주문 생성(금액은 서버가 계산)
//   GET  /api/orders           : (auth) 내 주문/결제 내역(마이페이지용)
//   POST /api/payments/confirm : (auth) 토스 승인 API 호출 + 금액 서버검증 + 결제완료 처리
// ------------------------------------------------------------

// 클라이언트키(공개키)만 내려준다. 시크릿키는 절대 노출하지 않는다.
app.get('/api/payments/config', (_req, res) => {
  if (!TOSS_CLIENT_KEY) {
    return res.status(500).json({ success: false, message: '결제 설정이 준비되지 않았습니다.' });
  }
  res.json({ success: true, data: { clientKey: TOSS_CLIENT_KEY } });
});

// 고유 orderId 생성: [A-Za-z0-9_-] 6~64자 규칙 충족. (shop-<user>-<time>-<rand>)
function makeOrderId(userId) {
  return `shop-${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// shop_orders row → 클라이언트 Order JSON.
function toOrder(row) {
  return {
    orderId: row.order_id,
    amount: Number(row.amount),
    orderName: row.order_name,
    status: row.status,
    method: row.method,
    items: Array.isArray(row.items) ? row.items : [],
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

// 현재 장바구니로 pending 주문 생성. 금액/상품명은 서버가 장바구니에서 계산(클라 금액 불신).
app.post('/api/orders', requireAuth, async (req, res) => {
  try {
    const cart = await getCartSummary(req.user.userId);
    if (!cart.items.length) {
      return res.status(400).json({ success: false, message: '장바구니가 비어 있습니다.' });
    }
    const first = cart.items[0].name;
    const orderName = cart.items.length > 1 ? `${first} 외 ${cart.items.length - 1}건` : first;
    const orderId = makeOrderId(req.user.userId);
    const itemsSnapshot = cart.items.map((i) => ({
      productId: i.productId, name: i.name, price: i.price, quantity: i.quantity, lineTotal: i.lineTotal,
    }));

    await pool.query(
      `INSERT INTO shop_orders (order_id, user_id, amount, order_name, status, items)
       VALUES ($1, $2, $3, $4, 'pending', $5::jsonb)`,
      [orderId, req.user.userId, cart.totalAmount, orderName, JSON.stringify(itemsSnapshot)]
    );

    res.status(201).json({ success: true, data: { orderId, amount: cart.totalAmount, orderName } });
  } catch (err) {
    console.error('POST /api/orders:', err.message);
    res.status(500).json({ success: false, message: '주문을 생성하지 못했습니다.' });
  }
});

// 내 주문/결제 내역(마이페이지). 완료(paid) 건을 최신 주문순으로. 미결제(pending) 는 숨긴다.
// 정렬: 주문 생성시각(created_at) 내림차순 = 최신 주문이 맨 위. id 는 IDENTITY(단조 증가)라
//       동일 시각 tie-break 로 써서 최신순을 확실히 보장한다.
app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT order_id, amount, order_name, status, method, items, created_at, paid_at
         FROM shop_orders
        WHERE user_id = $1 AND status = 'paid'
        ORDER BY created_at DESC, id DESC`,
      [req.user.userId]
    );
    res.json({ success: true, data: rows.map(toOrder) });
  } catch (err) {
    console.error('GET /api/orders:', err.message);
    res.status(500).json({ success: false, message: '주문 내역을 불러오지 못했습니다.' });
  }
});

// 결제 승인: 금액 서버검증 → 토스 confirm → 결제완료(주문 paid + 장바구니 비움).
app.post('/api/payments/confirm', requireAuth, async (req, res) => {
  try {
    if (!TOSS_SECRET_KEY) {
      return res.status(500).json({ success: false, message: '결제 설정이 준비되지 않았습니다.' });
    }
    const paymentKey = req.body && typeof req.body.paymentKey === 'string' ? req.body.paymentKey.trim() : '';
    const orderId = req.body && typeof req.body.orderId === 'string' ? req.body.orderId.trim() : '';
    const amount = Number(req.body && req.body.amount);
    if (!paymentKey || !orderId || !Number.isInteger(amount)) {
      return res.status(400).json({ success: false, message: '결제 정보가 올바르지 않습니다.' });
    }

    // 내 주문만 조회(주문-사용자 소유권 확인).
    const { rows } = await pool.query(
      'SELECT amount, order_name, status FROM shop_orders WHERE order_id = $1 AND user_id = $2',
      [orderId, req.user.userId]
    );
    const order = rows[0];
    if (!order) {
      return res.status(404).json({ success: false, message: '주문을 찾을 수 없습니다.' });
    }
    // 이미 완료된 주문이면 멱등 응답(새로고침/중복 confirm 방어).
    if (order.status === 'paid') {
      return res.json({ success: true, data: { orderId, orderName: order.order_name, amount: Number(order.amount), alreadyDone: true } });
    }
    // 🔒 금액 서버검증: 저장된 주문 금액과 다르면 승인하지 않는다(위변조 차단).
    if (Number(order.amount) !== amount) {
      return res.status(400).json({ success: false, message: '결제 금액이 일치하지 않습니다.' });
    }

    // 토스 결제 승인 API. 인증 = base64(시크릿키:). fetch 는 Node 18+ 전역.
    const auth = Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');
    const tossRes = await fetch(TOSS_CONFIRM_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    const toss = await tossRes.json().catch(() => ({}));

    if (!tossRes.ok) {
      await pool.query("UPDATE shop_orders SET status = 'failed' WHERE order_id = $1", [orderId]);
      console.error('Toss confirm 실패:', toss.code, toss.message);
      return res.status(400).json({ success: false, message: toss.message || '결제 승인에 실패했습니다.', code: toss.code });
    }

    // 승인 성공 → 주문 완료 표시 + 장바구니 비우기.
    await pool.query(
      "UPDATE shop_orders SET status = 'paid', payment_key = $2, method = $3, paid_at = now() WHERE order_id = $1",
      [orderId, paymentKey, toss.method || null]
    );
    await pool.query('DELETE FROM shop_cart_items WHERE user_id = $1', [req.user.userId]);

    res.json({
      success: true,
      data: {
        orderId,
        orderName: order.order_name,
        amount: Number(order.amount),
        method: toss.method || null,
        approvedAt: toss.approvedAt || null,
      },
    });
  } catch (err) {
    console.error('POST /api/payments/confirm:', err.message);
    res.status(500).json({ success: false, message: '결제 승인 처리 중 오류가 발생했습니다.' });
  }
});

// ------------------------------------------------------------
// 🖼️ Profile photo (ImageKit) — 로그인 사용자 프로필 사진 업로드/변경
//   GET  /api/imagekit/auth  : (auth) 클라이언트 업로드용 인증 파라미터(서명은 서버가 계산)
//   POST /api/profile/avatar : (auth) 업로드된 이미지 URL 을 내 프로필로 저장(빈 값이면 기본으로)
// ------------------------------------------------------------

// ImageKit 클라이언트 업로드 인증. signature = HMAC-SHA1(token + expire, PRIVATE_KEY).
// PRIVATE_KEY 는 이 계산에만 쓰고 응답에 넣지 않는다(공개키만 내려줌).
app.get('/api/imagekit/auth', requireAuth, (_req, res) => {
  if (!IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_PUBLIC_KEY) {
    return res.status(500).json({ success: false, message: '이미지 업로드 설정이 준비되지 않았습니다.' });
  }
  const token = crypto.randomBytes(16).toString('hex');
  const expire = Math.floor(Date.now() / 1000) + 600; // 만료 10분(최대 1시간)
  const signature = crypto.createHmac('sha1', IMAGEKIT_PRIVATE_KEY).update(token + expire).digest('hex');
  res.json({ success: true, data: { token, expire, signature, publicKey: IMAGEKIT_PUBLIC_KEY } });
});

// 프로필 사진 저장. avatarUrl 은 반드시 우리 ImageKit 엔드포인트의 URL 이어야 한다(임의 URL 차단).
// 빈 문자열이면 기본 이미지(이니셜)로 되돌린다.
app.post('/api/profile/avatar', requireAuth, async (req, res) => {
  try {
    const avatarUrl = req.body && typeof req.body.avatarUrl === 'string' ? req.body.avatarUrl.trim() : '';
    if (avatarUrl) {
      if (!IMAGEKIT_URL_ENDPOINT || !avatarUrl.startsWith(IMAGEKIT_URL_ENDPOINT)) {
        return res.status(400).json({ success: false, message: '허용되지 않은 이미지 주소입니다.' });
      }
      if (avatarUrl.length > 1000) {
        return res.status(400).json({ success: false, message: '이미지 주소가 너무 깁니다.' });
      }
    }
    const { rows } = await pool.query(
      'UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id, email, avatar_url',
      [avatarUrl, req.user.userId]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: { user: authUser(rows[0]) } });
  } catch (err) {
    console.error('POST /api/profile/avatar:', err.message);
    res.status(500).json({ success: false, message: '프로필 사진을 저장하지 못했습니다.' });
  }
});

// 알 수 없는 /api 경로 → JSON 404.
app.use('/api', (_req, res) => res.status(404).json({ success: false, message: '존재하지 않는 API 경로입니다.' }));

// SPA fallback: serve index.html for any non-API GET.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------------------------------------------------------
// Local: start server. Serverless (Vercel): export app.
// ------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`영유아 쇼핑몰 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
