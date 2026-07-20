// ============================================================================
// 익명 고민/칭찬/응원/건의 게시판 — Node.js (Express) + Supabase Postgres
//
//  · 정적 파일(index.html) 서빙 + REST API
//  · DB: Supabase Transaction Pooler(pgbouncer, 6543) — SSL 필수
//  · 보안: 연결 문자열은 .env(DATABASE_URL)에서만 읽음(코드 하드코딩 금지). 프론트 노출 금지.
//  · 모든 쿼리는 파라미터라이즈드($1,$2…)로 SQL 인젝션 방지.
//
//  로컬:   node server.js   → http://localhost:3000
//  Vercel: module.exports = app  (서버리스 함수로 동작)
// ============================================================================

const path = require('path');
const express = require('express');
const { Pool } = require('pg');

// .env 로드 — 외부 의존성 없이 직접 파싱(이 파일 옆의 .env만, dotenv 불필요).
// dotenv는 cwd 기준이라 레포 루트에서 실행하면 못 읽는 함정이 있어 __dirname 고정.
(function loadDotEnv() {
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue; // 주석/빈 줄 무시
      const key = m[1];
      let val = m[2];
      // 양끝 따옴표 제거
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) {
    console.warn('[env] .env 로드 건너뜀:', e.message);
  }
})();

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

// 연결 문자열: .env(DATABASE_URL)에서만 읽는다. 비밀번호를 코드에 하드코딩하지 않음
// — quest/는 공개 레포로 동기화되므로 폴백에 자격증명을 두면 유출된다. 없으면 즉시 실패.
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
if (!DATABASE_URL) {
  console.error('[config] DATABASE_URL이 없습니다. server.js 옆에 .env 파일을 만들고 DATABASE_URL=postgresql://... 을 설정하세요.');
  process.exit(1);
}

// 허용 카테고리 — 프론트의 CATEGORIES 키와 일치해야 함.
const VALID_CATEGORIES = ['worry', 'praise', 'support', 'suggest'];

// ---------------------------------------------------------------------------
// PG Pool — 풀러(pgbouncer) + SSL. 풀 크기 작게.
//   pgbouncer transaction 모드에서는 named prepared statement가 깨지므로
//   pool.query(text, params) 의 단순 사용만 한다(이 코드엔 named statement 없음).
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[pg] idle client 오류:', err.message);
});

// 작은 쿼리 헬퍼 (로깅 포함)
async function q(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error('[pg] 쿼리 실패:', err.message, '\n  SQL:', text.replace(/\s+/g, ' ').trim());
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 스키마 생성 + 시드 — lazy init(서버리스 cold start 대응). 1회만 실행.
// ---------------------------------------------------------------------------
let dbInitialized = false;
let initPromise = null;

async function initDB() {
  if (dbInitialized) return;
  if (initPromise) return initPromise; // 동시 요청 시 중복 실행 방지

  initPromise = (async () => {
    // posts
    await q(`
      CREATE TABLE IF NOT EXISTS posts (
        id            BIGSERIAL PRIMARY KEY,
        category      TEXT        NOT NULL,
        nickname      TEXT        NOT NULL,
        content       TEXT        NOT NULL,
        empathy_count INTEGER     NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // replies (post_id FK, 중첩용 parent_reply_id 포함)
    await q(`
      CREATE TABLE IF NOT EXISTS replies (
        id              BIGSERIAL PRIMARY KEY,
        post_id         BIGINT      NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        parent_reply_id BIGINT      REFERENCES replies(id) ON DELETE CASCADE,
        nickname        TEXT        NOT NULL,
        content         TEXT        NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await q(`CREATE INDEX IF NOT EXISTS idx_replies_post_id ON replies(post_id)`);

    // 시드 — posts 가 비어 있을 때만
    const { rows } = await q(`SELECT COUNT(*)::int AS n FROM posts`);
    if (rows[0].n === 0) {
      await seed();
      console.log('[db] 시드 데이터 삽입 완료');
    }

    dbInitialized = true;
    console.log('[db] 초기화 완료 (테이블 준비됨)');
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

// 샘플 시드 — 카테고리 섞어서 5개, 답글/공감 포함. created_at 을 과거로 분산.
async function seed() {
  const samples = [
    {
      category: 'praise', nickname: '반짝이는 수달', minsAgo: 4, empathy: 7,
      content: '오늘 길에서 넘어진 할머니를 도와드렸어요. 별거 아니지만 하루 종일 마음이 따뜻했답니다.',
      replies: [{ nickname: '다정한 곰', content: '그 마음이 진짜 멋져요. 덕분에 저도 따뜻해졌어요.', minsAgo: 2 }],
    },
    {
      category: 'worry', nickname: '조용한 고슴도치', minsAgo: 28, empathy: 12,
      content: '요즘 진로가 너무 고민이에요. 다들 앞으로 나아가는 것 같은데 저만 제자리인 것 같아서 마음이 무겁네요.',
      replies: [
        { nickname: '든든한 판다', content: '제자리처럼 보여도 분명 안에서 자라고 있을 거예요. 너무 조급해하지 말아요.', minsAgo: 20 },
        { nickname: '느긋한 거북이', content: '저도 같은 고민 했어요. 한 걸음씩이면 충분해요.', minsAgo: 11 },
      ],
    },
    {
      category: 'support', nickname: '씩씩한 펭귄', minsAgo: 180, empathy: 23,
      content: '드디어 3개월 동안 준비한 시험에 합격했습니다! 포기하고 싶을 때가 많았는데 끝까지 해낸 제가 조금은 자랑스러워요.',
      replies: [],
    },
    {
      category: 'worry', nickname: '꿈꾸는 여우', minsAgo: 360, empathy: 9,
      content: '친한 친구와 사소한 일로 다퉜는데 먼저 연락하기가 망설여져요. 시간이 지날수록 더 어색해질까 봐 걱정돼요.',
      replies: [{ nickname: '솔직한 너구리', content: '용기 내서 먼저 "그때 미안했어" 한마디면 의외로 금방 풀릴지도 몰라요.', minsAgo: 300 }],
    },
    {
      category: 'suggest', nickname: '신중한 부엉이', minsAgo: 90, empathy: 5,
      content: '게시판에 정렬 기능이 있으면 공감 많은 글을 보기 편할 것 같아요. 작은 건의 드립니다.',
      replies: [{ nickname: '여유로운 알파카', content: '저도 동감이에요. 최신순/공감순 둘 다 있으면 좋겠네요.', minsAgo: 60 }],
    },
  ];

  for (const s of samples) {
    const { rows } = await q(
      `INSERT INTO posts (category, nickname, content, empathy_count, created_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)
       RETURNING id`,
      [s.category, s.nickname, s.content, s.empathy, String(s.minsAgo)]
    );
    const postId = rows[0].id;
    for (const r of s.replies) {
      await q(
        `INSERT INTO replies (post_id, nickname, content, created_at)
         VALUES ($1, $2, $3, now() - ($4 || ' minutes')::interval)`,
        [postId, r.nickname, r.content, String(r.minsAgo)]
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 응답 헬퍼 — { success, data, message } 일관 구조
// ---------------------------------------------------------------------------
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// ---------------------------------------------------------------------------
// 앱 / 미들웨어
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// 정적 파일 — index.html 등. (API 라우트보다 먼저 두어도 /api 는 아래 라우트가 처리)
app.use(express.static(path.join(__dirname)));

// /api 진입 시 DB 초기화 보장
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('[db] 초기화 실패:', err.message);
    fail(res, 500, '데이터베이스 초기화에 실패했습니다.');
  }
});

// ---------------------------------------------------------------------------
// 라우트
// ---------------------------------------------------------------------------

// GET /api/posts?sort=latest|empathy  — 글 목록 + 답글 임베드 + 답글 수
app.get('/api/posts', async (req, res) => {
  const sort = req.query.sort === 'empathy' ? 'empathy' : 'latest';
  const orderBy =
    sort === 'empathy'
      ? 'p.empathy_count DESC, p.created_at DESC'
      : 'p.created_at DESC';

  try {
    // 각 글의 답글을 JSON 배열로 임베드. 답글은 작성순(오래된 → 최신).
    const { rows } = await q(
      `SELECT
         p.id,
         p.category,
         p.nickname,
         p.content,
         p.empathy_count,
         p.created_at,
         COALESCE(r.replies, '[]'::json) AS replies,
         COALESCE(r.reply_count, 0)     AS reply_count
       FROM posts p
       LEFT JOIN (
         SELECT
           post_id,
           COUNT(*)::int AS reply_count,
           json_agg(
             json_build_object(
               'id', id,
               'parent_reply_id', parent_reply_id,
               'nickname', nickname,
               'content', content,
               'created_at', created_at
             ) ORDER BY created_at ASC
           ) AS replies
         FROM replies
         GROUP BY post_id
       ) r ON r.post_id = p.id
       ORDER BY ${orderBy}`
    );
    ok(res, rows);
  } catch (err) {
    fail(res, 500, '게시글 목록을 불러오지 못했습니다.');
  }
});

// POST /api/posts  {category, nickname, content}
app.post('/api/posts', async (req, res) => {
  const { category, nickname, content } = req.body || {};

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return fail(res, 400, '유효하지 않은 분류입니다.');
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    return fail(res, 400, '내용을 입력해 주세요.');
  }
  if (content.trim().length > 500) {
    return fail(res, 400, '내용은 500자 이내로 입력해 주세요.');
  }
  const nick = (typeof nickname === 'string' && nickname.trim()) ? nickname.trim() : '익명';

  try {
    const { rows } = await q(
      `INSERT INTO posts (category, nickname, content)
       VALUES ($1, $2, $3)
       RETURNING id, category, nickname, content, empathy_count, created_at`,
      [category, nick.slice(0, 40), content.trim()]
    );
    // 새 글이므로 답글은 빈 배열
    ok(res, { ...rows[0], replies: [], reply_count: 0 }, 201);
  } catch (err) {
    fail(res, 500, '게시글 등록에 실패했습니다.');
  }
});

// POST /api/posts/:id/empathy  — +1
app.post('/api/posts/:id/empathy', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, '잘못된 게시글 번호입니다.');

  try {
    const { rows } = await q(
      `UPDATE posts SET empathy_count = empathy_count + 1
       WHERE id = $1
       RETURNING id, empathy_count`,
      [id]
    );
    if (rows.length === 0) return fail(res, 404, '게시글을 찾을 수 없습니다.');
    ok(res, rows[0]);
  } catch (err) {
    fail(res, 500, '공감 처리에 실패했습니다.');
  }
});

// DELETE /api/posts/:id/empathy  — -1 (0 미만 방지)
app.delete('/api/posts/:id/empathy', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, '잘못된 게시글 번호입니다.');

  try {
    const { rows } = await q(
      `UPDATE posts SET empathy_count = GREATEST(empathy_count - 1, 0)
       WHERE id = $1
       RETURNING id, empathy_count`,
      [id]
    );
    if (rows.length === 0) return fail(res, 404, '게시글을 찾을 수 없습니다.');
    ok(res, rows[0]);
  } catch (err) {
    fail(res, 500, '공감 취소에 실패했습니다.');
  }
});

// GET /api/posts/:id/replies  — 답글 목록 (임베드를 쓰지 않을 때 대비)
app.get('/api/posts/:id/replies', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, '잘못된 게시글 번호입니다.');

  try {
    const { rows } = await q(
      `SELECT id, post_id, parent_reply_id, nickname, content, created_at
       FROM replies WHERE post_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    ok(res, rows);
  } catch (err) {
    fail(res, 500, '답글을 불러오지 못했습니다.');
  }
});

// POST /api/posts/:id/replies  {nickname, content, parent_reply_id?}
app.post('/api/posts/:id/replies', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, '잘못된 게시글 번호입니다.');

  const { nickname, content, parent_reply_id } = req.body || {};
  if (typeof content !== 'string' || content.trim().length === 0) {
    return fail(res, 400, '답글 내용을 입력해 주세요.');
  }
  if (content.trim().length > 300) {
    return fail(res, 400, '답글은 300자 이내로 입력해 주세요.');
  }
  const nick = (typeof nickname === 'string' && nickname.trim()) ? nickname.trim() : '익명';
  let parentId = null;
  if (parent_reply_id !== undefined && parent_reply_id !== null) {
    parentId = Number(parent_reply_id);
    if (!Number.isInteger(parentId) || parentId <= 0) return fail(res, 400, '잘못된 상위 답글 번호입니다.');
  }

  try {
    // 글 존재 확인
    const exists = await q(`SELECT 1 FROM posts WHERE id = $1`, [id]);
    if (exists.rows.length === 0) return fail(res, 404, '게시글을 찾을 수 없습니다.');

    const { rows } = await q(
      `INSERT INTO replies (post_id, parent_reply_id, nickname, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, post_id, parent_reply_id, nickname, content, created_at`,
      [id, parentId, nick.slice(0, 40), content.trim()]
    );
    ok(res, rows[0], 201);
  } catch (err) {
    fail(res, 500, '답글 등록에 실패했습니다.');
  }
});

// 헬스체크 (선택)
app.get('/api/health', async (_req, res) => {
  try {
    await q('SELECT 1');
    ok(res, { db: 'up' });
  } catch (err) {
    fail(res, 500, 'DB 연결 불가');
  }
});

// API 404 (정적 파일/SPA fallback 전에)
app.use('/api', (_req, res) => fail(res, 404, '존재하지 않는 API 경로입니다.'));

// SPA fallback — 그 외 GET 요청은 index.html (Express 4 와일드카드 문법)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 에러 핸들러 — 마지막. (예: JSON 파싱 실패)
app.use((err, _req, res, _next) => {
  console.error('[err]', err.message);
  if (err.type === 'entity.parse.failed') {
    return fail(res, 400, '요청 본문(JSON) 형식이 올바르지 않습니다.');
  }
  fail(res, 500, '서버 내부 오류가 발생했습니다.');
});

// ---------------------------------------------------------------------------
// 기동 — 로컬에서는 listen, Vercel 서버리스에서는 export.
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] 익명 게시판 서버 실행 → http://localhost:${PORT}`);
    // 미리 한 번 초기화 시도(실패해도 첫 /api 요청에서 재시도)
    initDB().catch((e) => console.error('[db] 초기 init 실패(요청 시 재시도):', e.message));
  });
}

module.exports = app;
