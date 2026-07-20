// ============================================================
// 실시간 밸런스 게임 — API server
// Express + PostgreSQL (Supabase). 단일 프론트엔드 index.html(인라인 React) + 이 server.js.
//
// 데이터 모델 (정규화된 2개 테이블):
//   bg_questions : 밸런스 게임 질문(선택지 A/B). 사용자가 등록 가능.
//   bg_votes     : 개별 투표 1건 = 1행. (question_id, voter_id) 유니크로 1인 1표.
//   → 결과(%)와 총 참여자수는 모두 bg_votes 를 집계해서 계산한다.
//
// 공용 Supabase 를 다른 quest 앱과 공유하므로 테이블명에 bg_ 접두사를 붙여 충돌을 피한다.
// ============================================================

const path = require('path');

// Load .env from next to this file, regardless of cwd.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ============================================================
// 🌱 Seed — 재밌는 질문 3개. (이모지는 선택지 텍스트에 포함)
//   데모가 비어 보이지 않도록 질문별로 샘플 투표를 합성 voter_id 로 함께 주입한다.
// ============================================================
const SEED_QUESTIONS = [
  { option_a: '🍜 평생 라면만 먹기',           option_b: '🍗 평생 치킨만 먹기',          seed_a: 2, seed_b: 4 },
  { option_a: '💸 월급 2배인데 주말마다 출근',  option_b: '🛌 월급 그대로 주 4일 근무',    seed_a: 3, seed_b: 4 },
  { option_a: '🧠 모든 시험 무조건 합격',       option_b: '🍀 로또 1등 한 번 당첨',        seed_a: 4, seed_b: 3 },
];

const asString = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));

// ------------------------------------------------------------
// Lazy migration + seed (dbInitialized 로 1회만).
// ------------------------------------------------------------
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;

  // 이전 단일 테이블 설계(오늘 만든 데모) 정리 — IF EXISTS 라 1회 후 no-op.
  await pool.query('DROP TABLE IF EXISTS balance_questions');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bg_questions (
      "id"         BIGSERIAL PRIMARY KEY,
      "option_a"   TEXT NOT NULL,
      "option_b"   TEXT NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bg_votes (
      "id"          BIGSERIAL PRIMARY KEY,
      "question_id" BIGINT NOT NULL REFERENCES bg_questions("id") ON DELETE CASCADE,
      "choice"      TEXT NOT NULL CHECK ("choice" IN ('a','b')),
      "voter_id"    TEXT NOT NULL,
      "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("question_id", "voter_id")
    );
  `);

  const seeded = await pool.query('SELECT count(*)::int AS n FROM bg_questions');
  if (seeded.rows[0].n === 0) {
    // seed 전체를 한 트랜잭션으로 — 도중 실패하면 ROLLBACK 되어 다음 시도에 다시 seed.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const it of SEED_QUESTIONS) {
        const ins = await client.query(
          'INSERT INTO bg_questions ("option_a","option_b") VALUES ($1,$2) RETURNING "id"',
          [it.option_a, it.option_b]
        );
        const qid = ins.rows[0].id;
        // 샘플 투표 일괄 주입 — 합성 voter_id 로 UNIQUE 충돌 없이.
        // $1 은 bigint(question_id) 로만 쓰고, voter_id 접두사는 별도 text 파라미터($3)로
        // 넘겨서 "$1 의 타입이 bigint? text?" 추론 충돌을 피한다.
        await client.query(
          `INSERT INTO bg_votes ("question_id","choice","voter_id")
           SELECT $1::bigint, $2, $3 || g::text FROM generate_series(1, $4) g`,
          [qid, 'a', `seed-${qid}-a-`, it.seed_a]
        );
        await client.query(
          `INSERT INTO bg_votes ("question_id","choice","voter_id")
           SELECT $1::bigint, $2, $3 || g::text FROM generate_series(1, $4) g`,
          [qid, 'b', `seed-${qid}-b-`, it.seed_b]
        );
      }
      await client.query('COMMIT');
      console.log(`Seeded ${SEED_QUESTIONS.length} questions with sample votes.`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  dbInitialized = true;
}

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init failed:', err.message);
    res.status(500).json({ success: false, message: '데이터베이스 초기화에 실패했습니다.' });
  }
});

// ============================================================
// 집계 쿼리 헬퍼
// ============================================================
// 질문 + 득표수(votes 조인 집계). 최신 등록 질문이 위로.
const QUESTIONS_WITH_TALLY = `
  SELECT q."id", q."option_a", q."option_b", q."created_at",
         COALESCE(SUM(CASE WHEN v."choice" = 'a' THEN 1 ELSE 0 END), 0)::int AS votes_a,
         COALESCE(SUM(CASE WHEN v."choice" = 'b' THEN 1 ELSE 0 END), 0)::int AS votes_b
  FROM bg_questions q
  LEFT JOIN bg_votes v ON v."question_id" = q."id"
  GROUP BY q."id"
  ORDER BY q."created_at" DESC, q."id" DESC
`;

// 전체 참여자수 = 중복 제거한 voter 수.
async function totalParticipants() {
  const { rows } = await pool.query('SELECT COUNT(DISTINCT "voter_id")::int AS n FROM bg_votes');
  return rows[0].n;
}

// ============================================================
// ⚖️ API
// ============================================================

// 질문 목록 + 집계 + 총 참여자수.
app.get('/api/questions', async (_req, res) => {
  try {
    const { rows } = await pool.query(QUESTIONS_WITH_TALLY);
    res.json({ success: true, data: { questions: rows, totalParticipants: await totalParticipants() } });
  } catch (err) {
    console.error('GET /api/questions:', err.message);
    res.status(500).json({ success: false, message: '질문을 불러오지 못했습니다.' });
  }
});

// 폴링용 경량 집계(질문 텍스트 제외) + 총 참여자수.
app.get('/api/results', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT "question_id" AS id,
             COALESCE(SUM(CASE WHEN "choice" = 'a' THEN 1 ELSE 0 END), 0)::int AS votes_a,
             COALESCE(SUM(CASE WHEN "choice" = 'b' THEN 1 ELSE 0 END), 0)::int AS votes_b
      FROM bg_votes
      GROUP BY "question_id"
    `);
    res.json({ success: true, data: { tallies: rows, totalParticipants: await totalParticipants() } });
  } catch (err) {
    console.error('GET /api/results:', err.message);
    res.status(500).json({ success: false, message: '결과를 불러오지 못했습니다.' });
  }
});

// 질문 등록.
app.post('/api/questions', async (req, res) => {
  try {
    const a = asString(req.body && req.body.option_a).trim();
    const b = asString(req.body && req.body.option_b).trim();
    if (!a || !b) {
      return res.status(400).json({ success: false, message: '두 선택지를 모두 입력해 주세요.' });
    }
    if (a.length > 100 || b.length > 100) {
      return res.status(400).json({ success: false, message: '선택지는 100자 이내로 입력해 주세요.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO bg_questions ("option_a","option_b") VALUES ($1,$2)
       RETURNING "id","option_a","option_b","created_at"`,
      [a, b]
    );
    res.status(201).json({ success: true, data: { ...rows[0], votes_a: 0, votes_b: 0 } });
  } catch (err) {
    console.error('POST /api/questions:', err.message);
    res.status(500).json({ success: false, message: '질문을 등록하지 못했습니다.' });
  }
});

// 투표 — body { choice: 'a'|'b', voter_id }. 1인 1표(중복은 조용히 무시).
app.post('/api/questions/:id/vote', async (req, res) => {
  try {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ success: false, message: '잘못된 질문 ID 입니다.' });
    }
    const choice = req.body && req.body.choice;
    const voter = asString(req.body && req.body.voter_id).trim();
    if (choice !== 'a' && choice !== 'b') {
      return res.status(400).json({ success: false, message: "choice 는 'a' 또는 'b' 여야 합니다." });
    }
    if (!voter) {
      return res.status(400).json({ success: false, message: 'voter_id 가 필요합니다.' });
    }

    const exists = await pool.query('SELECT 1 FROM bg_questions WHERE "id" = $1', [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, message: '질문을 찾을 수 없습니다.' });
    }

    await pool.query(
      `INSERT INTO bg_votes ("question_id","choice","voter_id") VALUES ($1,$2,$3)
       ON CONFLICT ("question_id","voter_id") DO NOTHING`,
      [id, choice, voter]
    );

    const { rows } = await pool.query(`
      SELECT $1::bigint AS id,
             COALESCE(SUM(CASE WHEN "choice" = 'a' THEN 1 ELSE 0 END), 0)::int AS votes_a,
             COALESCE(SUM(CASE WHEN "choice" = 'b' THEN 1 ELSE 0 END), 0)::int AS votes_b
      FROM bg_votes WHERE "question_id" = $1
    `, [id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('POST /api/questions/:id/vote:', err.message);
    res.status(500).json({ success: false, message: '투표를 처리하지 못했습니다.' });
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
    console.log(`실시간 밸런스 게임 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
