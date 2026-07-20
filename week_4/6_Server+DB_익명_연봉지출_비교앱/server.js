// ============================================================
// 익명 연봉/지출 비교 앱 — API server
// Express + PostgreSQL (Supabase). 단일 프론트엔드 index.html(인라인 React) + 이 server.js.
//
// 데이터 모델 (단일 테이블):
//   salary_entries : 익명 제출 1건 = 1행. 직군/연차/월급 + 5개 지출 항목.
//   → 모든 금액 단위는 "만원"(정수)이다. (월급 400 = 400만원)
//   → 평균/중앙값/분포/백분위는 모두 salary_entries 전체를 집계해서 계산한다.
//
// 공용 Supabase 를 다른 quest 앱과 공유하므로 테이블명에 salary_ 접두사(salary_entries)를
// 붙여 충돌을 피한다.
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

// 직군(job_category) 허용값. 프론트 셀렉트와 동일해야 한다.
const JOB_CATEGORIES = [
  '개발', '디자인', '기획/PM', '마케팅', '영업',
  '경영/지원', '금융', '의료', '교육', '제조/생산', '기타',
];

// distribution 고정 7개 버킷. 경계 규칙: min <= salary < max (마지막은 salary >= 1000).
// 프론트가 이 정의(라벨/경계/순서)에 의존하므로 절대 바꾸지 말 것.
const SALARY_BUCKETS = [
  { label: '~200',     min: 0,    max: 200 },
  { label: '200~300',  min: 200,  max: 300 },
  { label: '300~400',  min: 300,  max: 400 },
  { label: '400~500',  min: 400,  max: 500 },
  { label: '500~700',  min: 500,  max: 700 },
  { label: '700~1000', min: 700,  max: 1000 },
  { label: '1000~',    min: 1000, max: null },
];

// ============================================================
// 🌱 Seed — 현실적인 한국 직장인 표본(약 60건).
//   연차↑일수록 월급↑ 상관, 직군별 차이(개발/금융이 높은 편), 200~1200 범위의 자연스러운 분포.
//   각 지출 항목은 월급에 비례해 그럴듯하게(주거비가 보통 가장 큼).
//   [직군, 연차, 월급, 식비, 주거, 교통, 교육, 기타]  — 단위 모두 만원.
// ============================================================
const SEED_ENTRIES = [
  // 개발 — 비교적 높은 편, 연차에 따른 상승
  ['개발',        1,  280,  50,  70,  20,  20,  40],
  ['개발',        2,  330,  55,  80,  20,  20,  45],
  ['개발',        3,  400,  60,  90,  25,  30,  50],
  ['개발',        5,  480,  65, 100,  25,  35,  60],
  ['개발',        7,  560,  70, 110,  30,  40,  70],
  ['개발',        9,  650,  75, 130,  30,  50,  80],
  ['개발',       12,  780,  85, 150,  35,  60, 100],
  ['개발',       15,  920,  90, 170,  40,  70, 120],
  // 디자인
  ['디자인',      1,  250,  45,  65,  18,  15,  35],
  ['디자인',      3,  320,  50,  80,  20,  20,  45],
  ['디자인',      5,  390,  55,  90,  22,  25,  50],
  ['디자인',      8,  470,  60, 100,  25,  30,  60],
  ['디자인',     11,  560,  68, 115,  28,  35,  72],
  // 기획/PM
  ['기획/PM',     2,  310,  50,  78,  20,  20,  44],
  ['기획/PM',     4,  390,  56,  92,  22,  28,  52],
  ['기획/PM',     6,  470,  62, 102,  26,  32,  62],
  ['기획/PM',     9,  580,  70, 120,  30,  42,  76],
  ['기획/PM',    13,  720,  80, 145,  34,  55,  95],
  // 마케팅
  ['마케팅',      1,  260,  46,  68,  18,  16,  38],
  ['마케팅',      3,  330,  52,  82,  21,  22,  46],
  ['마케팅',      6,  430,  58,  96,  24,  28,  56],
  ['마케팅',     10,  540,  66, 112,  28,  36,  70],
  // 영업
  ['영업',        2,  300,  50,  76,  22,  18,  46],
  ['영업',        4,  380,  56,  88,  26,  22,  54],
  ['영업',        7,  500,  64, 104,  30,  28,  68],
  ['영업',       11,  640,  74, 128,  34,  40,  86],
  // 경영/지원
  ['경영/지원',   2,  290,  48,  74,  18,  18,  42],
  ['경영/지원',   5,  380,  55,  90,  22,  24,  52],
  ['경영/지원',   8,  460,  60, 100,  25,  30,  60],
  ['경영/지원',  12,  580,  70, 120,  30,  42,  76],
  // 금융 — 높은 편
  ['금융',        1,  330,  55,  85,  20,  25,  50],
  ['금융',        3,  430,  62, 100,  24,  35,  62],
  ['금융',        5,  560,  72, 120,  28,  45,  80],
  ['금융',        8,  720,  82, 150,  32,  60, 105],
  ['금융',       11,  900,  95, 180,  38,  75, 135],
  ['금융',       15, 1150, 110, 220,  45, 100, 180],
  // 의료
  ['의료',        2,  360,  58,  88,  22,  28,  54],
  ['의료',        5,  520,  68, 110,  26,  40,  74],
  ['의료',        9,  700,  80, 145,  32,  55, 100],
  ['의료',       14,  980, 100, 185,  40,  78, 145],
  // 교육
  ['교육',        1,  230,  44,  62,  16,  14,  32],
  ['교육',        4,  300,  50,  78,  20,  20,  44],
  ['교육',        8,  400,  56,  92,  23,  26,  54],
  ['교육',       13,  520,  66, 110,  28,  36,  70],
  // 제조/생산
  ['제조/생산',   2,  270,  48,  70,  22,  16,  40],
  ['제조/생산',   5,  350,  54,  84,  26,  20,  50],
  ['제조/생산',   9,  450,  60,  98,  30,  26,  62],
  ['제조/생산',  14,  580,  70, 120,  34,  36,  80],
  // 기타
  ['기타',        1,  220,  42,  60,  16,  12,  30],
  ['기타',        3,  290,  48,  74,  20,  18,  42],
  ['기타',        6,  370,  54,  88,  24,  24,  52],
  ['기타',       10,  480,  62, 102,  28,  32,  64],
  // 분포 꼬리를 채우는 추가 표본 (저연차 신입 / 고연차 임원급)
  ['개발',        0,  240,  46,  62,  18,  14,  34],
  ['디자인',      0,  220,  42,  58,  16,  12,  30],
  ['마케팅',      0,  230,  44,  60,  16,  14,  32],
  ['금융',       20, 1250, 120, 240,  48, 110, 200],
  ['개발',       18, 1050, 100, 195,  42,  82, 150],
  ['의료',       18, 1180, 110, 215,  44,  95, 175],
  ['기획/PM',    16,  820,  88, 160,  36,  62, 108],
  ['영업',       15,  760,  82, 150,  38,  52, 100],
  ['경영/지원',  16,  680,  78, 140,  34,  50,  92],
  ['교육',       18,  600,  72, 122,  30,  40,  78],
];

const asString = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));

// 정수화 + 음수/NaN 방어. 통과 못하면 null 반환(검증 단계에서 거른다).
function toInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

// ------------------------------------------------------------
// Lazy migration + seed (dbInitialized 로 1회만). 서버리스 cold start 대비.
// ------------------------------------------------------------
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS salary_entries (
      "id"             BIGSERIAL PRIMARY KEY,
      "job_category"   TEXT NOT NULL,
      "years"          INTEGER NOT NULL DEFAULT 0,
      "monthly_salary" INTEGER NOT NULL,
      "exp_food"       INTEGER NOT NULL DEFAULT 0,
      "exp_housing"    INTEGER NOT NULL DEFAULT 0,
      "exp_transport"  INTEGER NOT NULL DEFAULT 0,
      "exp_education"  INTEGER NOT NULL DEFAULT 0,
      "exp_etc"        INTEGER NOT NULL DEFAULT 0,
      "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const c = await pool.query('SELECT count(*)::int AS n FROM salary_entries');
  if (c.rows[0].n === 0) {
    // 표본을 한 번의 멀티-VALUES INSERT 로 주입.
    const values = [];
    const params = [];
    SEED_ENTRIES.forEach((row, i) => {
      const b = i * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
      params.push(...row);
    });
    await pool.query(
      `INSERT INTO salary_entries
        ("job_category","years","monthly_salary","exp_food","exp_housing","exp_transport","exp_education","exp_etc")
       VALUES ${values.join(',')}`,
      params
    );
    console.log(`Seeded ${SEED_ENTRIES.length} salary entries.`);
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
// 📊 통계 계산 헬퍼 (전부 JS 에서 round 처리 — 프론트 정의에 정확히 맞춘다)
// ============================================================
const round = (n) => Math.round(n);

// 정수 배열의 중앙값(정수 반환).
function medianInt(sorted) {
  const len = sorted.length;
  if (len === 0) return 0;
  const mid = Math.floor(len / 2);
  if (len % 2 === 1) return sorted[mid];
  return round((sorted[mid - 1] + sorted[mid]) / 2);
}

// salary 가 속하는 버킷 인덱스(0~6). 경계: min <= s < max, 마지막은 s >= 1000.
function bucketIndexOf(salary) {
  for (let i = 0; i < SALARY_BUCKETS.length; i++) {
    const { min, max } = SALARY_BUCKETS[i];
    if (max === null) {
      if (salary >= min) return i;
    } else if (salary >= min && salary < max) {
      return i;
    }
  }
  // 음수 등 예외 — 첫 버킷으로.
  return 0;
}

// 전체 표본 행으로부터 통계 객체를 구성. my 는 salary 가 주어졌을 때만 채운다.
function computeStats(rows, mySalary) {
  const count = rows.length;

  if (count === 0) {
    return {
      count: 0,
      salary: {
        avgMonthly: 0, median: 0, min: 0, max: 0,
        distribution: SALARY_BUCKETS.map((b) => ({ label: b.label, min: b.min, max: b.max, count: 0 })),
      },
      expenses: {
        avg: { food: 0, housing: 0, transport: 0, education: 0, etc: 0 },
        avgTotal: 0,
      },
      byJob: [],
      my: mySalary == null ? null
        : { salary: mySalary, rankTop: 0, beatsPercent: 0, bucketIndex: bucketIndexOf(mySalary) },
    };
  }

  const salaries = rows.map((r) => r.monthly_salary);
  const sortedSalaries = [...salaries].sort((a, b) => a - b);

  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  const avgMonthly = round(sum(salaries) / count);
  const median = medianInt(sortedSalaries);
  const min = sortedSalaries[0];
  const max = sortedSalaries[sortedSalaries.length - 1];

  // distribution — 고정 버킷별 count.
  const distribution = SALARY_BUCKETS.map((b) => {
    const inBucket = salaries.filter((s) =>
      b.max === null ? s >= b.min : (s >= b.min && s < b.max)
    ).length;
    return { label: b.label, min: b.min, max: b.max, count: inBucket };
  });

  // expenses 평균.
  const avg = {
    food:      round(sum(rows.map((r) => r.exp_food)) / count),
    housing:   round(sum(rows.map((r) => r.exp_housing)) / count),
    transport: round(sum(rows.map((r) => r.exp_transport)) / count),
    education: round(sum(rows.map((r) => r.exp_education)) / count),
    etc:       round(sum(rows.map((r) => r.exp_etc)) / count),
  };
  const avgTotal = avg.food + avg.housing + avg.transport + avg.education + avg.etc;

  // byJob — 직군별 표본수/평균월급/평균총지출. count 내림차순, 0 인 직군 제외.
  const byJobMap = new Map();
  for (const r of rows) {
    let g = byJobMap.get(r.job_category);
    if (!g) {
      g = { jobCategory: r.job_category, count: 0, salarySum: 0, expSum: 0 };
      byJobMap.set(r.job_category, g);
    }
    g.count += 1;
    g.salarySum += r.monthly_salary;
    g.expSum += r.exp_food + r.exp_housing + r.exp_transport + r.exp_education + r.exp_etc;
  }
  const byJob = [...byJobMap.values()]
    .map((g) => ({
      jobCategory: g.jobCategory,
      count: g.count,
      avgSalary: round(g.salarySum / g.count),
      avgExpenseTotal: round(g.expSum / g.count),
    }))
    .sort((a, b) => b.count - a.count || b.avgSalary - a.avgSalary);

  // my — salary 가 주어졌을 때만.
  let my = null;
  if (mySalary != null) {
    const higher = salaries.filter((s) => s > mySalary).length; // 나보다 많이 버는 사람
    const lower = salaries.filter((s) => s < mySalary).length;  // 나보다 적게 버는 사람
    my = {
      salary: mySalary,
      rankTop: round((100 * higher) / count),     // "상위 N%" — 많이 벌수록 작아짐
      beatsPercent: round((100 * lower) / count), // 내가 이긴 비율
      bucketIndex: bucketIndexOf(mySalary),
    };
  }

  return {
    count,
    salary: { avgMonthly, median, min, max, distribution },
    expenses: { avg, avgTotal },
    byJob,
    my,
  };
}

// ============================================================
// 💰 API
// ============================================================

// 익명 제출.
app.post('/api/entries', async (req, res) => {
  try {
    const body = req.body || {};

    const jobCategory = asString(body.jobCategory).trim();
    if (!jobCategory) {
      return res.status(400).json({ success: false, message: '직군을 선택해 주세요.' });
    }
    if (!JOB_CATEGORIES.includes(jobCategory)) {
      return res.status(400).json({ success: false, message: '허용되지 않은 직군입니다.' });
    }

    const years = toInt(body.years);
    if (years == null || years < 0 || years > 50) {
      return res.status(400).json({ success: false, message: '연차는 0~50 사이의 숫자여야 합니다.' });
    }

    const monthlySalary = toInt(body.monthlySalary);
    if (monthlySalary == null || monthlySalary <= 0) {
      return res.status(400).json({ success: false, message: '월급(만원)은 0보다 큰 숫자여야 합니다.' });
    }

    // 지출 — 각 항목 정수화 + 음수 방어(누락 시 0).
    const expenses = body.expenses || {};
    const keys = ['food', 'housing', 'transport', 'education', 'etc'];
    const exp = {};
    for (const k of keys) {
      const raw = expenses[k];
      const v = (raw === undefined || raw === null || raw === '') ? 0 : toInt(raw);
      if (v == null || v < 0) {
        return res.status(400).json({ success: false, message: '지출 항목은 0 이상의 숫자여야 합니다.' });
      }
      exp[k] = v;
    }

    const { rows } = await pool.query(
      `INSERT INTO salary_entries
        ("job_category","years","monthly_salary","exp_food","exp_housing","exp_transport","exp_education","exp_etc")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING "id"`,
      [jobCategory, years, monthlySalary, exp.food, exp.housing, exp.transport, exp.education, exp.etc]
    );

    res.status(201).json({ success: true, data: { id: Number(rows[0].id) } });
  } catch (err) {
    console.error('POST /api/entries:', err.message);
    res.status(500).json({ success: false, message: '제출을 저장하지 못했습니다.' });
  }
});

// 통계 — ?salary=<int>&jobCategory=<optional>.
// 전체 모집단(salary_entries 전체) 기준으로 집계. salary 가 있으면 내 백분위(my)도 계산.
app.get('/api/stats', async (req, res) => {
  try {
    // salary 쿼리 — 있으면 정수화. 0 이하/NaN 은 무효로 보고 my=null 처리.
    let mySalary = null;
    if (req.query.salary !== undefined && asString(req.query.salary).trim() !== '') {
      const s = toInt(req.query.salary);
      if (s != null && s > 0) mySalary = s;
    }

    const { rows } = await pool.query(`
      SELECT "job_category", "years", "monthly_salary",
             "exp_food", "exp_housing", "exp_transport", "exp_education", "exp_etc"
      FROM salary_entries
    `);

    const data = computeStats(rows, mySalary);
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/stats:', err.message);
    res.status(500).json({ success: false, message: '통계를 불러오지 못했습니다.' });
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
    console.log(`익명 연봉/지출 비교 앱 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
