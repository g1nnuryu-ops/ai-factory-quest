// ============================================================
// 개인 가계부(수입/지출 관리) 앱 — API server
// Express + PostgreSQL (Supabase). 단일 프론트엔드 index.html(인라인 React) + 이 server.js.
//
// 데이터 모델 (단일 테이블):
//   ledger_entries : 수입/지출 1건 = 1행. (type, 날짜, 금액, 카테고리, 메모)
//   → 금액(amount) 단위는 "원"(양의 정수). BIGINT 로 저장.
//
// 공용 Supabase 를 다른 quest 앱과 공유하므로 테이블명에 ledger_ 접두사(ledger_entries)를
// 붙여 충돌을 피한다.
// ============================================================

const path = require('path');

// Load .env: 앱 로컬(있으면) → week_5 공유 .env(DATABASE_URL 여기 있음) 순서로.
// dotenv 는 이미 설정된 값은 덮어쓰지 않으므로, 로컬 .env 가 우선한다.
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// 카테고리 allow-list — 프론트 select 와 100% 동일해야 한다. type 별로 검증.
const CATEGORIES = {
  expense: ['식비', '카페/간식', '교통', '주거/통신', '생활/마트', '쇼핑/의류', '의료/건강', '문화/여가', '교육', '경조사/기타'],
  income: ['급여', '용돈', '부수입', '금융수입', '기타'],
};

// ============================================================
// 🌱 Seed — 테이블이 비어있을 때만. [type, date, amount(원), category, memo]
// ============================================================
const SEED_ENTRIES = [
  ['income',  '2026-06-25', 3200000, '급여',      '6월 월급'],
  ['income',  '2026-06-10',  150000, '부수입',    '중고거래'],
  ['expense', '2026-06-01',  850000, '주거/통신', '월세+관리비'],
  ['expense', '2026-06-03',   62000, '식비',      '장보기'],
  ['expense', '2026-06-05',    4500, '카페/간식', '아메리카노'],
  ['expense', '2026-06-07',   33000, '교통',      '교통카드 충전'],
  ['expense', '2026-06-09',  128000, '생활/마트', '생필품'],
  ['expense', '2026-06-12',   45000, '문화/여가', '영화+저녁'],
  ['expense', '2026-06-15',   89000, '쇼핑/의류', '여름 티셔츠'],
  ['expense', '2026-06-18',   23000, '의료/건강', '약국'],
  ['expense', '2026-06-20',   38000, '식비',      '외식'],
];

// ============================================================
// 🌱 과거 데모 내역 — 월별 추이 차트가 의미있도록 2026-01~05 5개월치.
//   (2026-06 이전 데이터가 하나도 없을 때만 1회 주입 → idempotent)
//   [type, date, amount(원), category, memo]
// ============================================================
const HISTORY_SEED = [
  // 2026-01 (지출 105만)
  ['income',  '2026-01-25', 3200000, '급여',       '1월 월급'],
  ['expense', '2026-01-01',  850000, '주거/통신',  '월세+관리비'],
  ['expense', '2026-01-06',   58000, '식비',       '장보기'],
  ['expense', '2026-01-08',   30000, '교통',       '교통카드 충전'],
  ['expense', '2026-01-14',   72000, '생활/마트',  '생필품'],
  ['expense', '2026-01-20',   40000, '문화/여가',  '영화'],
  // 2026-02 (설날 — 지출 130.5만)
  ['income',  '2026-02-25', 3200000, '급여',       '2월 월급'],
  ['income',  '2026-02-17',  300000, '부수입',     '설날 보너스'],
  ['expense', '2026-02-01',  850000, '주거/통신',  '월세+관리비'],
  ['expense', '2026-02-16',  250000, '경조사/기타', '설날 선물/세뱃돈'],
  ['expense', '2026-02-05',   80000, '식비',       '명절 장보기'],
  ['expense', '2026-02-15',   60000, '교통',       '귀성 KTX'],
  ['expense', '2026-02-10',   65000, '생활/마트',  '생필품'],
  // 2026-03 (지출 114.3만)
  ['income',  '2026-03-25', 3300000, '급여',       '3월 월급(인상)'],
  ['expense', '2026-03-01',  850000, '주거/통신',  '월세+관리비'],
  ['expense', '2026-03-07',   62000, '식비',       '장보기'],
  ['expense', '2026-03-12',  110000, '쇼핑/의류',  '봄옷'],
  ['expense', '2026-03-05',   18000, '카페/간식',  '카페'],
  ['expense', '2026-03-09',   33000, '교통',       '교통카드 충전'],
  ['expense', '2026-03-18',   70000, '생활/마트',  '생필품'],
  // 2026-04 (지출 116.1만)
  ['income',  '2026-04-25', 3300000, '급여',       '4월 월급'],
  ['expense', '2026-04-01',  850000, '주거/통신',  '월세+관리비'],
  ['expense', '2026-04-10',   95000, '의료/건강',  '치과 진료'],
  ['expense', '2026-04-06',   60000, '식비',       '장보기'],
  ['expense', '2026-04-19',   55000, '문화/여가',  '전시+저녁'],
  ['expense', '2026-04-08',   33000, '교통',       '교통카드 충전'],
  ['expense', '2026-04-22',   68000, '생활/마트',  '생필품'],
  // 2026-05 (가정의 달 — 지출 129.4만)
  ['income',  '2026-05-25', 3300000, '급여',       '5월 월급'],
  ['income',  '2026-05-08',  100000, '용돈',       '용돈'],
  ['expense', '2026-05-01',  850000, '주거/통신',  '월세+관리비'],
  ['expense', '2026-05-08',  180000, '경조사/기타', '어버이날 선물'],
  ['expense', '2026-05-05',   75000, '식비',       '가족 외식'],
  ['expense', '2026-05-14',   90000, '쇼핑/의류',  '봄옷'],
  ['expense', '2026-05-09',   33000, '교통',       '교통카드 충전'],
  ['expense', '2026-05-20',   66000, '생활/마트',  '생필품'],
];

const asString = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));

// 정수화 + NaN 방어. 통과 못하면 null 반환(검증 단계에서 거른다).
function toInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

// 'YYYY-MM-DD' 형식 + 실제 유효 날짜 검증. 유효하면 true.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // 월/일 오버플로(예: 2026-02-30)를 되돌려 잡는다.
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 'YYYY-MM' 형식 검증. month 쿼리 파라미터용.
const MONTH_RE = /^\d{4}-\d{2}$/;

// DB row → 클라이언트 Entry JSON.
// entry_date 는 SELECT 에서 to_char 로 문자열화하여 date(string)로 받는다(타임존 밀림 방지).
// amount 는 BIGINT → pg 가 문자열로 주므로 Number() 로 숫자화.
function toEntry(row) {
  return {
    id: Number(row.id),
    type: row.type,
    date: row.date, // already 'YYYY-MM-DD' via to_char
    amount: Number(row.amount),
    category: row.category,
    memo: row.memo,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// ------------------------------------------------------------
// Lazy migration + seed (dbInitialized 로 1회만). 서버리스 cold start 대비.
// ------------------------------------------------------------
// 멀티-VALUES INSERT 로 시드 행들을 한 번에 주입. row = [type, date, amount, category, memo]
async function insertEntries(rows) {
  if (!rows.length) return;
  const values = [];
  const params = [];
  rows.forEach((row, i) => {
    const b = i * 5;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
    params.push(...row);
  });
  await pool.query(
    `INSERT INTO ledger_entries ("type","entry_date","amount","category","memo")
     VALUES ${values.join(',')}`,
    params
  );
}

let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      "id"         BIGSERIAL PRIMARY KEY,
      "type"       TEXT NOT NULL CHECK ("type" IN ('income','expense')),
      "entry_date" DATE NOT NULL,
      "amount"     BIGINT NOT NULL CHECK ("amount" > 0),
      "category"   TEXT NOT NULL,
      "memo"       TEXT NOT NULL DEFAULT '',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const c = await pool.query('SELECT count(*)::int AS n FROM ledger_entries');
  if (c.rows[0].n === 0) {
    await insertEntries(SEED_ENTRIES);
    console.log(`Seeded ${SEED_ENTRIES.length} ledger entries.`);
  }

  // 월별 추이 차트용 과거(2026-06 이전) 데모 내역을 1회만 주입. 이미 있으면 건너뜀(idempotent).
  const h = await pool.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE "entry_date" < '2026-06-01'`);
  if (h.rows[0].n === 0) {
    await insertEntries(HISTORY_SEED);
    console.log(`Seeded ${HISTORY_SEED.length} historical ledger entries.`);
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

// month 쿼리 파라미터를 검증해 'YYYY-MM' 또는 null 로 반환. 형식 틀리면 undefined(=잘못된 입력).
function parseMonth(q) {
  if (q === undefined || asString(q).trim() === '') return null; // 필터 없음
  const m = asString(q).trim();
  return MONTH_RE.test(m) ? m : undefined; // undefined = invalid
}

// ============================================================
// 💰 API
// ============================================================

// 1. 목록 — GET /api/entries?month=YYYY-MM (month 선택)
app.get('/api/entries', async (req, res) => {
  try {
    const month = parseMonth(req.query.month);
    if (month === undefined) {
      return res.status(400).json({ success: false, message: 'month 형식은 YYYY-MM 이어야 합니다.' });
    }

    const where = month ? `WHERE to_char("entry_date", 'YYYY-MM') = $1` : '';
    const params = month ? [month] : [];
    const { rows } = await pool.query(
      `SELECT "id", "type",
              to_char("entry_date", 'YYYY-MM-DD') AS date,
              "amount", "category", "memo", "created_at"
       FROM ledger_entries
       ${where}
       ORDER BY "entry_date" DESC, "id" DESC`,
      params
    );

    res.json({ success: true, data: rows.map(toEntry) });
  } catch (err) {
    console.error('GET /api/entries:', err.message);
    res.status(500).json({ success: false, message: '내역을 불러오지 못했습니다.' });
  }
});

// 2. 추가 — POST /api/entries  body { type, date, amount, category, memo? }
app.post('/api/entries', async (req, res) => {
  try {
    const body = req.body || {};

    const type = asString(body.type).trim();
    if (type !== 'income' && type !== 'expense') {
      return res.status(400).json({ success: false, message: "type 은 'income' 또는 'expense' 여야 합니다." });
    }

    const date = asString(body.date).trim();
    if (!isValidDate(date)) {
      return res.status(400).json({ success: false, message: '날짜(date)는 유효한 YYYY-MM-DD 여야 합니다.' });
    }

    const amount = toInt(body.amount);
    if (amount == null || amount <= 0) {
      return res.status(400).json({ success: false, message: '금액(amount)은 0보다 큰 정수여야 합니다.' });
    }

    const category = asString(body.category).trim();
    if (!category) {
      return res.status(400).json({ success: false, message: '카테고리를 선택해 주세요.' });
    }
    if (!CATEGORIES[type].includes(category)) {
      return res.status(400).json({ success: false, message: '해당 분류에 허용되지 않은 카테고리입니다.' });
    }

    // memo 는 선택. 누락 시 ''.
    const memoRaw = body.memo;
    const memo = (memoRaw === undefined || memoRaw === null) ? '' : asString(memoRaw);

    const { rows } = await pool.query(
      `INSERT INTO ledger_entries ("type","entry_date","amount","category","memo")
       VALUES ($1,$2,$3,$4,$5)
       RETURNING "id", "type",
                 to_char("entry_date", 'YYYY-MM-DD') AS date,
                 "amount", "category", "memo", "created_at"`,
      [type, date, amount, category, memo]
    );

    res.status(201).json({ success: true, data: toEntry(rows[0]) });
  } catch (err) {
    console.error('POST /api/entries:', err.message);
    res.status(500).json({ success: false, message: '내역을 저장하지 못했습니다.' });
  }
});

// 3. 삭제 — DELETE /api/entries/:id
app.delete('/api/entries/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null || id <= 0 || String(id) !== asString(req.params.id).trim()) {
      return res.status(400).json({ success: false, message: 'id 는 양의 정수여야 합니다.' });
    }

    const { rowCount } = await pool.query('DELETE FROM ledger_entries WHERE "id" = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: '해당 내역을 찾을 수 없습니다.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/entries/:id:', err.message);
    res.status(500).json({ success: false, message: '내역을 삭제하지 못했습니다.' });
  }
});

// 4. 요약 — GET /api/summary?month=YYYY-MM (month 선택)
app.get('/api/summary', async (req, res) => {
  try {
    const month = parseMonth(req.query.month);
    if (month === undefined) {
      return res.status(400).json({ success: false, message: 'month 형식은 YYYY-MM 이어야 합니다.' });
    }

    const where = month ? `WHERE to_char("entry_date", 'YYYY-MM') = $1` : '';
    const params = month ? [month] : [];

    // 전체 행을 가져와 JS 에서 집계(작은 데이터셋, 명료함 우선).
    const { rows } = await pool.query(
      `SELECT "type", "amount", "category"
       FROM ledger_entries
       ${where}`,
      params
    );

    let totalIncome = 0;
    let totalExpense = 0;
    // category 별 합계/건수 누적 — type 별로 Map.
    const catMap = { income: new Map(), expense: new Map() };

    for (const r of rows) {
      const amt = Number(r.amount);
      if (r.type === 'income') totalIncome += amt;
      else if (r.type === 'expense') totalExpense += amt;

      const m = catMap[r.type];
      if (m) {
        const g = m.get(r.category) || { category: r.category, total: 0, count: 0 };
        g.total += amt;
        g.count += 1;
        m.set(r.category, g);
      }
    }

    // total 내림차순 정렬.
    const sortByTotal = (m) =>
      [...m.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, 'ko'));

    const data = {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      byCategory: {
        income: sortByTotal(catMap.income),
        expense: sortByTotal(catMap.expense),
      },
      count: rows.length,
    };

    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/summary:', err.message);
    res.status(500).json({ success: false, message: '요약을 불러오지 못했습니다.' });
  }
});

// 5. 월별 추이 — GET /api/monthly?months=N (최근 N개월, 기본 12, 1~60)
//    데이터가 있는 달만 집계해 과거→현재(오름차순)로 반환. 차트 시각화용.
app.get('/api/monthly', async (req, res) => {
  try {
    let months = toInt(req.query.months);
    if (months == null || months <= 0) months = 12;
    months = Math.min(months, 60);

    const { rows } = await pool.query(
      `SELECT to_char("entry_date", 'YYYY-MM') AS month,
              COALESCE(SUM("amount") FILTER (WHERE "type" = 'income'), 0)  AS income,
              COALESCE(SUM("amount") FILTER (WHERE "type" = 'expense'), 0) AS expense,
              count(*)::int AS count
       FROM ledger_entries
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT $1`,
      [months]
    );

    // 최근 N개월을 가져온 뒤, 표시용으로 과거→현재 순서로 뒤집는다.
    const data = rows
      .map((r) => ({
        month: r.month,
        income: Number(r.income),
        expense: Number(r.expense),
        count: Number(r.count),
      }))
      .reverse();

    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/monthly:', err.message);
    res.status(500).json({ success: false, message: '월별 추이를 불러오지 못했습니다.' });
  }
});

// 알 수 없는 /api 경로 → JSON 404.
app.use('/api', (_req, res) => res.status(404).json({ success: false, message: '존재하지 않는 API 경로입니다.' }));

// SPA fallback: serve index.html for any non-API GET. (Express 4 정규식 라우트)
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------------------------------------------------------
// Local: start server. Serverless (Vercel): export app.
// ------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`개인 가계부 앱 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
