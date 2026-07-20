// ============================================================
// 커뮤니티 게시판 API server (email/password + JWT auth)
// Express + PostgreSQL (Supabase) — 3-file architecture:
// server.js / index.html / client.js
//
// 데이터 모델:
//   users           : 계정(email/password_hash). 로그인 주체이자 글의 "작성자".
//   community_posts  : 게시글 1건 = 1행. (작성자 user_id, 제목, 내용)
//
// 권한 규칙:
//   - 모든 API 는 로그인(JWT) 필요.
//   - 목록/상세 조회: 로그인한 누구나 모든 글을 볼 수 있다(작성자 이름 포함).
//   - 작성: 로그인한 사용자. 작성자는 토큰의 user 로 고정(클라이언트가 못 바꾼다).
//   - 수정/삭제: 본인이 쓴 글만(WHERE user_id = 나 AND id = :id).
//
// 공용 Supabase 를 다른 quest 앱과 공유하므로 도메인 테이블명에 community_ 접두사를
// 붙여 충돌을 피한다. users 는 인증 공용 테이블이라 그대로 둔다.
// ============================================================

const path = require('path');

// Load .env from next to this file, regardless of the current working
// directory (so `node server.js` works even when launched from elsewhere).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// .trim() guards against trailing-newline quirks in platform env vars.
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const SALT_ROUNDS = 10;
const TOKEN_TTL = '7d';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 입력 길이 상한 — 프론트 maxLength 와 맞춘다.
const TITLE_MAX = 120;
const CONTENT_MAX = 5000;

// ------------------------------------------------------------
// PostgreSQL pool (Supabase transaction pooler requires SSL)
// .trim() guards against trailing-newline quirks in env vars.
// ------------------------------------------------------------
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ------------------------------------------------------------
// Lazy migration: create the tables once. The flag prevents the
// CREATE TABLE from re-running on every request / serverless cold start.
// ------------------------------------------------------------
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // 목록은 항상 최신순으로 읽으므로 created_at 인덱스로 정렬을 돕는다.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS community_posts_created_idx ON community_posts (created_at DESC, id DESC);`
  );
  dbInitialized = true;
}

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Ensure the tables exist before any /api request is handled.
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

// 이메일에서 표시용 작성자 이름(@ 앞부분)을 만든다. 클라이언트도 같은 규칙을 쓴다.
function displayName(email) {
  return typeof email === 'string' ? email.split('@')[0] : '';
}

// DB row(JOIN users) → 클라이언트 Post JSON.
// created_at/updated_at 은 pg 가 Date 로 주고, res.json 이 ISO 문자열로 직렬화한다.
function toPost(row, { withContent = true } = {}) {
  const post = {
    id: Number(row.id),
    authorId: Number(row.user_id),
    authorEmail: row.author_email,
    authorName: displayName(row.author_email),
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (withContent) post.content = row.content;
  return post;
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
      data: { token, user: { id: Number(user.id), email: user.email, name: displayName(user.email) } },
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
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];

    // Same generic message for unknown email OR wrong password (no user enumeration).
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!ok) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = signToken(user);
    res.json({
      success: true,
      data: { token, user: { id: Number(user.id), email: user.email, name: displayName(user.email) } },
    });
  } catch (err) {
    console.error('POST /api/auth/login:', err.message);
    res.status(500).json({ success: false, message: '로그인에 실패했습니다.' });
  }
});

// Current user from the token.
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: { user: { id: Number(req.user.userId), email: req.user.email, name: displayName(req.user.email) } },
  });
});

// ------------------------------------------------------------
// Post routes (ALL require auth)
//   목록/상세는 모든 글 공개(작성자 포함). 수정/삭제는 본인 글만.
// ------------------------------------------------------------

// 제목/내용 입력 검증. 통과하면 { title, content }, 아니면 res 로 400 응답 후 null.
function readPostBody(req, res) {
  const title = (req.body && typeof req.body.title === 'string') ? req.body.title.trim() : '';
  const content = (req.body && typeof req.body.content === 'string') ? req.body.content.trim() : '';
  if (!title) {
    res.status(400).json({ success: false, message: '제목을 입력해주세요.' });
    return null;
  }
  if (title.length > TITLE_MAX) {
    res.status(400).json({ success: false, message: `제목은 ${TITLE_MAX}자 이하여야 합니다.` });
    return null;
  }
  if (!content) {
    res.status(400).json({ success: false, message: '내용을 입력해주세요.' });
    return null;
  }
  if (content.length > CONTENT_MAX) {
    res.status(400).json({ success: false, message: `내용은 ${CONTENT_MAX}자 이하여야 합니다.` });
    return null;
  }
  return { title, content };
}

// URL 파라미터 :id 를 양의 정수로 파싱. 아니면 res 로 400 후 null.
function readId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, message: '잘못된 글 번호입니다.' });
    return null;
  }
  return id;
}

// 1. 목록 — GET /api/posts : 모든 글을 최신순으로. (내용 제외, 목록 화면용)
app.get('/api/posts', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.user_id, p.title, p.created_at, p.updated_at, u.email AS author_email
       FROM community_posts p
       JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC, p.id DESC`
    );
    res.json({ success: true, data: rows.map((r) => toPost(r, { withContent: false })) });
  } catch (err) {
    console.error('GET /api/posts:', err.message);
    res.status(500).json({ success: false, message: '글 목록을 불러오지 못했습니다.' });
  }
});

// 2. 상세 — GET /api/posts/:id : 로그인한 누구나 볼 수 있다(내용 포함).
app.get('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = readId(req, res);
    if (id == null) return;

    const { rows } = await pool.query(
      `SELECT p.id, p.user_id, p.title, p.content, p.created_at, p.updated_at, u.email AS author_email
       FROM community_posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 글을 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: toPost(rows[0]) });
  } catch (err) {
    console.error('GET /api/posts/:id:', err.message);
    res.status(500).json({ success: false, message: '글을 불러오지 못했습니다.' });
  }
});

// 3. 작성 — POST /api/posts : 작성자는 토큰의 user 로 고정.
app.post('/api/posts', requireAuth, async (req, res) => {
  try {
    const body = readPostBody(req, res);
    if (body == null) return;

    const { rows } = await pool.query(
      `WITH inserted AS (
         INSERT INTO community_posts (user_id, title, content)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, title, content, created_at, updated_at
       )
       SELECT i.*, u.email AS author_email
       FROM inserted i JOIN users u ON u.id = i.user_id`,
      [req.user.userId, body.title, body.content]
    );
    res.status(201).json({ success: true, data: toPost(rows[0]) });
  } catch (err) {
    console.error('POST /api/posts:', err.message);
    res.status(500).json({ success: false, message: '글을 작성하지 못했습니다.' });
  }
});

// 4. 수정 — PATCH /api/posts/:id : 본인 글만(WHERE user_id = 나 AND id).
app.patch('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = readId(req, res);
    if (id == null) return;
    const body = readPostBody(req, res);
    if (body == null) return;

    const { rows } = await pool.query(
      `WITH updated AS (
         UPDATE community_posts
         SET title = $1, content = $2, updated_at = now()
         WHERE id = $3 AND user_id = $4
         RETURNING id, user_id, title, content, created_at, updated_at
       )
       SELECT u2.*, usr.email AS author_email
       FROM updated u2 JOIN users usr ON usr.id = u2.user_id`,
      [body.title, body.content, id, req.user.userId]
    );

    if (rows.length === 0) {
      // 글이 없거나(삭제됨) 내 글이 아님 — 둘 다 안전하게 404 로 처리.
      return res.status(404).json({ success: false, message: '글을 찾을 수 없거나 수정 권한이 없습니다.' });
    }
    res.json({ success: true, data: toPost(rows[0]) });
  } catch (err) {
    console.error('PATCH /api/posts/:id:', err.message);
    res.status(500).json({ success: false, message: '글을 수정하지 못했습니다.' });
  }
});

// 5. 삭제 — DELETE /api/posts/:id : 본인 글만.
app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = readId(req, res);
    if (id == null) return;

    const { rows } = await pool.query(
      'DELETE FROM community_posts WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '글을 찾을 수 없거나 삭제 권한이 없습니다.' });
    }
    res.json({ success: true, data: { id } });
  } catch (err) {
    console.error('DELETE /api/posts/:id:', err.message);
    res.status(500).json({ success: false, message: '글을 삭제하지 못했습니다.' });
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
    console.log(`커뮤니티 게시판 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
