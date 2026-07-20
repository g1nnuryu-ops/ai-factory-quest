// ============================================================
// 놀담(Noldam) 카페 사장님용 통합 대시보드 — API server
// Express + PostgreSQL (Supabase) + JWT auth. 3-file 구조: server.js / index.html / package.json
//
// 무엇을 하나:
//   - 이메일/비번 + JWT 인증(users 공용 테이블).
//   - 이미 시드된 카페 운영데이터(cafe_menu / cafe_daily_sales / cafe_menu_sales /
//     cafe_inventory / cafe_purchase_orders)를 "읽기만" 해서 KPI·차트·재고·발주를 집계.
//   - cafe_todos(할일/발주 메모)만 새로 만든다(비었을 때 1회 시드). 노션과 미러.
//   - 파주 날씨(OpenWeatherMap 2.5) + 요일평균 기반 손님수 예측(날씨는 가중치).
//   - AI 오늘의 브리핑(OpenAI Chat Completions, 오늘자 메모리 캐시, 실패 시 결정적 폴백).
//
// ⚠️ cafe_* 운영 테이블은 절대 DROP/수정하지 않는다. SELECT 전용.
// 배포: 로컬 `node server.js` + Vercel(`module.exports = app`).
// ============================================================

const path = require('path');

// .env 로드 순서: 로컬(JWT_SECRET/PORT/NOTION_MEMO_URL) → 상위 폴더 체인의 공유 .env
// (DATABASE_URL/OPENAI_*/OpenWeatherMap_api_key). dotenv 는 이미 설정된 값을 덮어쓰지 않으므로
// 로컬이 최우선, 그다음 가까운 조상 .env 가 이긴다.
// 이 앱은 week_5/6_카페컨셉_정하기/6-4_대시보드_앱 로 week_5 아래 2단계 중첩이라
// 공유 .env(week_5/.env)는 ../../.env 에 있다. 그래서 부모 체인을 위로 훑는다.
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3006;

// .trim() 은 플랫폼 env 의 끝 개행/공백 문제를 막는다(계약서 §2 필수).
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
// 주의: 이 키 이름의 특이한 대소문자를 그대로 읽는다.
const OWM_KEY = (process.env.OpenWeatherMap_api_key || '').trim();
const NOTION_MEMO_URL = (process.env.NOTION_MEMO_URL || '').trim() || null;

// --- 노션 '할일 & 발주 메모' 연동 (원본 = source of truth) ---
// NOTION_TOKEN 이 있으면 할일/발주 메모의 원본을 노션 DB 로 삼는다(읽기·쓰기 모두 노션 REST).
// 없으면 기존 Postgres(cafe_todos) 로 폴백 → 토큰 없이도 앱은 그대로 동작.
const NOTION_TOKEN = (process.env.NOTION_TOKEN || '').trim();
const NOTION_VERSION = '2022-06-28';
// URL/ID 문자열에서 32-hex Notion id 를 뽑아 대시 형태(8-4-4-4-12)로. NOTION_MEMO_URL 에서 DB id 유도.
function toNotionId(s) {
  const m = (s || '').replace(/-/g, '').match(/[0-9a-fA-F]{32}/);
  if (!m) return '';
  const h = m[0].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const NOTION_DB_ID = (process.env.NOTION_DB_ID || '').trim() || toNotionId(NOTION_MEMO_URL);
// 노션 속성 이름 — '놀담 카페 · 할일 & 발주 메모' DB 스키마와 정확히 일치해야 한다.
const NP = { title: '메모', category: '구분', done: '완료', created: '등록일' };
const USE_NOTION = Boolean(NOTION_TOKEN && NOTION_DB_ID);

const SALT_ROUNDS = 10;
const TOKEN_TTL = '7d';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 파주 좌표(계약서 §5-4 고정).
const LAT = 37.7599;
const LON = 126.7802;

const CAFE = { name: '놀담', concept: '키즈 브런치 카페', location: '파주' };
const TODO_CATEGORIES = ['할일', '발주'];

// cafe_todos 가 비었을 때만(1회) 시드하는 초기 메모(계약서 §7, 노션과 동일).
const SEED_TODOS = [
  ['발주', '원두-콜드브루 4kg 발주 — 현재고 3kg, 안전재고 4kg 미달'],
  ['발주', '오트밀크 10L 발주 — 현재고 8L, 안전재고 10L 미달'],
  ['발주', '딸기시럽 3병 발주 — 현재고 2병, 안전재고 3병 미달'],
  ['발주', '빨대 1,000개 발주 — 현재고 380개, 안전재고 500개 미달'],
  ['할일', '주말 브런치 재료 준비(리코타팬케이크·에그베네딕트)'],
  ['할일', '놀이존 매트·볼풀 소독'],
  ['할일', '신메뉴 인스타 업로드 및 예약 안내'],
  ['할일', '주말 아르바이트 스케줄 확정'],
];

// ------------------------------------------------------------
// PostgreSQL pool (Supabase pooler → SSL 필요)
// ------------------------------------------------------------
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ------------------------------------------------------------
// Lazy init: users / cafe_todos 만 보장. cafe_* 운영테이블은 손대지 않는다.
// 플래그로 매 요청 재실행을 막고, 서버리스 cold start 에도 안전하게 1회만.
// ------------------------------------------------------------
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;

  // 인증 공용 테이블(다른 quest 앱과 공유). 이미 있으면 그대로 사용.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // 할일/발주 메모: 노션을 원본으로 쓰면(USE_NOTION) Postgres 테이블은 만들지 않는다.
  // 토큰이 없을 때만 기존 cafe_todos 테이블을 보장하고 비어있으면 1회 시드한다(폴백 경로).
  if (!USE_NOTION) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cafe_todos (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        category TEXT NOT NULL CHECK (category IN ('할일','발주')),
        content TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // 비어있을 때만 1회 시드(기존 메모가 있으면 건너뜀).
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM cafe_todos');
    if (rows[0].n === 0) {
      const values = [];
      const params = [];
      SEED_TODOS.forEach((t, i) => {
        const b = i * 2;
        values.push(`($${b + 1}, $${b + 2})`);
        params.push(t[0], t[1]);
      });
      await pool.query(
        `INSERT INTO cafe_todos (category, content) VALUES ${values.join(', ')}`,
        params
      );
    }
  }

  dbInitialized = true;
}

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
app.use(express.json());
app.use(
  express.static(path.join(__dirname), {
    // index.html 캐시 꼬임 방지(계약서 §6). 이전 quest 앱 잔재 캐시가 뜨는 문제 예방.
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  })
);

// 모든 /api 요청 전에 테이블/시드 보장.
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
// 공통 헬퍼
// ------------------------------------------------------------
function signToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  try {
    const payload = jwt.verify(match[1].trim(), JWT_SECRET);
    req.user = { userId: payload.userId, email: payload.email };
    next();
  } catch (_err) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
}

// 이메일 @ 앞부분 = 표시용 이름(프론트도 같은 규칙).
function displayName(email) {
  return typeof email === 'string' ? email.split('@')[0] : '';
}

// pg NUMERIC/BIGINT 는 JS 문자열로 온다 → 반드시 숫자화. null → 0.
const num = (v) => (v == null ? 0 : Number(v));
// 원화 콤마(폴백 브리핑/코멘트용). 서버 Node full-ICU 기준.
const won = (n) => Number(n || 0).toLocaleString('ko-KR');

// 'YYYY-MM' → 직전 달 'YYYY-MM'
function prevMonthOf(ym) {
  let [y, m] = String(ym).split('-').map(Number);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// 서버 "오늘"을 Asia/Seoul 기준으로. dow 는 한글 요일 1글자(cafe_daily_sales 와 동일 표기).
// ICU 로케일 편차를 피하려 날짜만 뽑고 요일은 UTC 정오 기준으로 계산한다.
const KOR_DOW = ['일', '월', '화', '수', '목', '금', '토'];
function seoulToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  const today = `${y}-${m}-${d}`;
  const dowIdx = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay();
  return { today, dow: KOR_DOW[dowIdx], isWeekend: dowIdx === 0 || dowIdx === 6, dowIdx };
}

// ------------------------------------------------------------
// 인증 라우트 (토큰 불필요)
// ------------------------------------------------------------
app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';

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

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요.' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];

    // 존재/비번 구분 없는 동일 메시지(user enumeration 방지).
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

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: { user: { id: Number(req.user.userId), email: req.user.email, name: displayName(req.user.email) } },
  });
});

// ------------------------------------------------------------
// 데이터 빌더 (여러 라우트가 재사용)
// ------------------------------------------------------------

// KPI + 차트 + 재고 + 최근발주를 한 방에. cafe_* 는 전부 SELECT 전용.
// 날짜는 전부 to_char 로 문자열화해 KST 밀림을 막는다.
async function getSummaryData() {
  const meta = await pool.query(
    `SELECT to_char(max(sale_date),'YYYY-MM-DD') AS data_through,
            to_char(max(sale_date),'YYYY-MM')     AS month_label
       FROM cafe_daily_sales`
  );
  const monthLabel = meta.rows[0].month_label;      // "이달" = 데이터 최신월(2026-07)
  const prevMonthLabel = prevMonthOf(monthLabel);   // 2026-06

  const [dayRows, monthRows, totalRow, lowRow, trendRows, topRows, catRows, invRows, poRows] =
    await Promise.all([
      // 최신일 + 직전일(델타용)
      pool.query(
        `SELECT to_char(sale_date,'YYYY-MM-DD') d, day_of_week, customer_count, total_qty, total_revenue
           FROM cafe_daily_sales ORDER BY sale_date DESC LIMIT 2`
      ),
      // 이달/전월 합계
      pool.query(
        `SELECT to_char(sale_date,'YYYY-MM') ym,
                SUM(total_revenue)::bigint  revenue,
                SUM(total_qty)::bigint      qty,
                SUM(customer_count)::bigint customers,
                COUNT(*)::int               days
           FROM cafe_daily_sales
          WHERE to_char(sale_date,'YYYY-MM') IN ($1,$2)
          GROUP BY 1`,
        [monthLabel, prevMonthLabel]
      ),
      // 전체 누적 매출
      pool.query(`SELECT SUM(total_revenue)::bigint total FROM cafe_daily_sales`),
      // 재고 부족 개수
      pool.query(`SELECT COUNT(*)::int n FROM cafe_inventory WHERE current_stock < safety_stock`),
      // 최근 30일(오름차순)
      pool.query(
        `SELECT to_char(t.sale_date,'YYYY-MM-DD') date, t.day_of_week dow,
                t.total_revenue revenue, t.customer_count customers, t.total_qty qty
           FROM (SELECT sale_date, day_of_week, total_revenue, customer_count, total_qty
                   FROM cafe_daily_sales ORDER BY sale_date DESC LIMIT 30) t
          ORDER BY t.sale_date ASC`
      ),
      // 이달 인기메뉴 TOP 8(판매량 기준)
      pool.query(
        `SELECT m.name, m.category, SUM(ms.qty)::bigint qty, SUM(ms.revenue)::bigint revenue
           FROM cafe_menu_sales ms JOIN cafe_menu m ON m.id = ms.menu_id
          WHERE to_char(ms.sale_date,'YYYY-MM') = $1
          GROUP BY m.id, m.name, m.category
          ORDER BY qty DESC, revenue DESC
          LIMIT 8`,
        [monthLabel]
      ),
      // 이달 카테고리별 합계
      pool.query(
        `SELECT m.category, SUM(ms.qty)::bigint qty, SUM(ms.revenue)::bigint revenue
           FROM cafe_menu_sales ms JOIN cafe_menu m ON m.id = ms.menu_id
          WHERE to_char(ms.sale_date,'YYYY-MM') = $1
          GROUP BY m.category
          ORDER BY revenue DESC`,
        [monthLabel]
      ),
      // 재고 전체(부족 먼저 → 부족량 큰 순 → 이름)
      pool.query(
        `SELECT id, item_name, category, unit, unit_cost, current_stock, safety_stock
           FROM cafe_inventory
          ORDER BY (current_stock < safety_stock) DESC,
                   (safety_stock - current_stock) DESC,
                   item_name ASC`
      ),
      // 최근 발주 8건(품목명은 inventory 조인)
      pool.query(
        `SELECT to_char(po.order_date,'YYYY-MM-DD') order_date, i.item_name, i.unit,
                po.order_qty, po.unit_cost, po.total_cost, po.status,
                to_char(po.delivered_date,'YYYY-MM-DD') delivered_date
           FROM cafe_purchase_orders po
           LEFT JOIN cafe_inventory i ON i.id = po.item_id
          ORDER BY po.order_date DESC, po.id DESC
          LIMIT 8`
      ),
    ]);

  const latest = dayRows.rows[0] || {};
  const prev = dayRows.rows[1] || {};
  const mThis = monthRows.rows.find((x) => x.ym === monthLabel) || {};
  const mPrev = monthRows.rows.find((x) => x.ym === prevMonthLabel) || {};

  const kpi = {
    latestDate: latest.d || null,
    latestDow: latest.day_of_week || null,
    latestRevenue: num(latest.total_revenue),
    latestCustomers: num(latest.customer_count),
    latestQty: num(latest.total_qty),
    prevRevenue: num(prev.total_revenue),
    prevCustomers: num(prev.customer_count),
    monthLabel,
    monthRevenue: num(mThis.revenue),
    monthQty: num(mThis.qty),
    monthCustomers: num(mThis.customers),
    monthDays: num(mThis.days),
    prevMonthLabel,
    prevMonthRevenue: num(mPrev.revenue),
    totalRevenue: num(totalRow.rows[0].total),
    lowStockCount: num(lowRow.rows[0].n),
  };

  const salesTrend = trendRows.rows.map((r) => ({
    date: r.date, dow: r.dow, revenue: num(r.revenue), customers: num(r.customers), qty: num(r.qty),
  }));

  const topMenus = topRows.rows.map((r) => ({
    name: r.name, category: r.category, qty: num(r.qty), revenue: num(r.revenue),
  }));

  const categoryMix = catRows.rows.map((r) => ({
    category: r.category, qty: num(r.qty), revenue: num(r.revenue),
  }));

  const invItems = invRows.rows.map((r) => {
    const current = num(r.current_stock);
    const safety = num(r.safety_stock);
    const low = current < safety;
    return {
      id: Number(r.id), name: r.item_name, category: r.category, unit: r.unit,
      unitCost: num(r.unit_cost), current, safety,
      status: low ? '부족' : '정상', shortage: Math.max(0, safety - current),
    };
  });
  const inventory = {
    total: invItems.length,
    lowCount: invItems.filter((i) => i.status === '부족').length,
    items: invItems,
  };

  const recentOrders = poRows.rows.map((r) => ({
    orderDate: r.order_date,
    itemName: r.item_name || '(품목)',
    qty: num(r.order_qty),
    unit: r.unit || '',
    unitCost: num(r.unit_cost),
    totalCost: num(r.total_cost),
    status: r.status,
    deliveredDate: r.delivered_date, // null 가능
  }));

  return { kpi, salesTrend, topMenus, categoryMix, inventory, recentOrders };
}

// 파주 날씨 + 손님수 예측. 날씨 실패해도 절대 throw 하지 않는다(예측은 DB 요일평균으로 항상 동작).
async function getWeatherPrediction() {
  const { today, dow, isWeekend } = seoulToday();

  // baseline = 오늘 요일의 과거 평균 방문객(전체 기간). 요일 데이터가 없으면 전체 평균으로 폴백.
  let baseline;
  const bRes = await pool.query(
    `SELECT ROUND(AVG(customer_count))::int b FROM cafe_daily_sales WHERE day_of_week = $1`,
    [dow]
  );
  if (bRes.rows[0] && bRes.rows[0].b != null) {
    baseline = Number(bRes.rows[0].b);
  } else {
    const allRes = await pool.query(`SELECT ROUND(AVG(customer_count))::int b FROM cafe_daily_sales`);
    baseline = num(allRes.rows[0] && allRes.rows[0].b);
  }

  // 날씨 조회(200 아니면 available=false + error, 예외는 흡수).
  const weather = {
    available: false, desc: null, main: null, icon: null, temp: null, feelsLike: null,
    tempMin: null, tempMax: null, humidity: null, windSpeed: null, cloudiness: null,
  };
  if (!OWM_KEY) {
    weather.error = '날씨 API 키가 설정되지 않았습니다.';
  } else {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LON}&units=metric&lang=kr&appid=${OWM_KEY}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const w = await resp.json();
        const w0 = (w.weather && w.weather[0]) || {};
        weather.available = true;
        weather.desc = w0.description || null;
        weather.main = w0.main || null;
        weather.icon = w0.icon || null;
        if (w.main) {
          weather.temp = Number(w.main.temp);
          weather.feelsLike = Number(w.main.feels_like);
          weather.tempMin = Number(w.main.temp_min);
          weather.tempMax = Number(w.main.temp_max);
          weather.humidity = Number(w.main.humidity);
        }
        weather.windSpeed = w.wind ? Number(w.wind.speed) : null;
        weather.cloudiness = w.clouds ? Number(w.clouds.all) : null;
      } else {
        // 401(신규키 활성화 대기) 등: 본문 message 를 있으면 노출.
        let msg = `날씨 API 오류 (HTTP ${resp.status})`;
        try { const eb = await resp.json(); if (eb && eb.message) msg = `날씨 API 오류: ${eb.message}`; } catch (_e) { /* ignore */ }
        weather.error = msg;
      }
    } catch (err) {
      weather.error = `날씨 API 호출 실패: ${err.message}`;
    }
  }

  // 가중치 모델. 시작 1.0 → 조건별 배수 → clamp 0.7~1.15. available=false 면 1.0 고정.
  const factors = [{ label: `${dow}요일 평균`, effect: '0', detail: `과거 ${dow}요일 평균 방문 ${baseline}명` }];
  let mult = 1.0;
  if (weather.available) {
    const main = weather.main;
    if (['Rain', 'Snow', 'Thunderstorm', 'Drizzle'].includes(main)) {
      mult *= 0.82;
      factors.push({ label: weather.desc || '궂은 날씨', effect: '-', detail: '비·눈 예보로 가족단위 방문 감소 예상' });
    } else if (main === 'Clouds' && weather.cloudiness != null && weather.cloudiness > 75) {
      mult *= 0.95;
      factors.push({ label: '흐림', effect: '-', detail: `구름 많음(${weather.cloudiness}%)으로 나들이 수요 소폭 감소` });
    } else if (main === 'Clear' && isWeekend) {
      mult *= 1.08;
      factors.push({ label: '맑은 주말', effect: '+', detail: '맑은 날씨 + 주말로 가족 나들이 증가 기대' });
    }
    if (weather.temp != null && weather.temp > 33) {
      mult *= 0.9;
      factors.push({ label: '폭염', effect: '-', detail: `기온 ${Math.round(weather.temp)}°C — 외출 감소` });
    }
    if (weather.temp != null && weather.temp < -2) {
      mult *= 0.9;
      factors.push({ label: '한파', effect: '-', detail: `기온 ${Math.round(weather.temp)}°C — 외출 감소` });
    }
  } else {
    factors.push({ label: '날씨 정보 없음', effect: '0', detail: weather.error || '날씨 API 활성화 대기 중 — 요일 평균 기반 예측' });
  }

  mult = Math.max(0.7, Math.min(1.15, mult));
  const weatherMultiplier = Math.round(mult * 100) / 100;
  const predicted = Math.round(baseline * weatherMultiplier);
  const low = Math.round(predicted * 0.9);
  const high = Math.round(predicted * 1.1);

  let comment;
  if (!weather.available) {
    comment = `날씨 API 활성화 대기 중이라 ${dow}요일 평균으로 약 ${predicted}명 방문이 예상돼요.`;
  } else if (weatherMultiplier > 1) {
    comment = `좋은 날씨 영향으로 ${dow}요일 평균보다 방문이 늘어 약 ${predicted}명 예상돼요.`;
  } else if (weatherMultiplier < 1) {
    comment = `날씨 영향으로 방문이 다소 줄어 약 ${predicted}명(${low}~${high}명) 예상돼요.`;
  } else {
    comment = `${dow}요일 평균 수준인 약 ${predicted}명 방문이 예상돼요.`;
  }

  return {
    city: CAFE.location, lat: LAT, lon: LON,
    weather,
    prediction: { date: today, dow, isWeekend, baseline, predicted, low, high, weatherMultiplier, factors, comment },
  };
}

// ------------------------------------------------------------
// 할일/발주 메모 백엔드 — USE_NOTION 이면 노션 DB 가 원본, 아니면 Postgres.
// 두 백엔드 모두 { id, category, content, done, createdAt } 형태의 아이템을 주고받는다.
// id 는 문자열(노션=page UUID, pg=숫자 문자열). 프런트는 id 를 React key / URL 경로로만 쓴다.
// ------------------------------------------------------------

// 노션 REST 호출 래퍼(Node18+ 전역 fetch). 실패 시 status/notion 을 담아 throw.
async function notionApi(pathname, { method = 'GET', body } = {}) {
  const resp = await fetch(`https://api.notion.com/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error((data && data.message) || `Notion API ${resp.status}`);
    err.status = resp.status;
    err.notion = data;
    throw err;
  }
  return data;
}

// 노션 page → todo 아이템
function mapNotionTodo(page) {
  const p = page.properties || {};
  const titleArr = (p[NP.title] && p[NP.title].title) || [];
  const content = titleArr.map((t) => t.plain_text).join('').trim();
  const category =
    (p[NP.category] && p[NP.category].select && p[NP.category].select.name) || TODO_CATEGORIES[0];
  const done = Boolean(p[NP.done] && p[NP.done].checkbox);
  const createdAt = (p[NP.created] && p[NP.created].created_time) || page.created_time;
  return { id: page.id, category, content, done, createdAt };
}

// 미완료 먼저(done ASC), 최신 먼저(createdAt DESC).
function sortTodoItems(items) {
  return items.sort((a, b) =>
    a.done === b.done ? String(b.createdAt).localeCompare(String(a.createdAt)) : a.done ? 1 : -1
  );
}

const notionTodos = {
  async list() {
    const items = [];
    let cursor = null;
    do {
      const data = await notionApi(`/databases/${NOTION_DB_ID}/query`, {
        method: 'POST',
        body: cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 },
      });
      (data.results || []).forEach((pg) => items.push(mapNotionTodo(pg)));
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);
    return sortTodoItems(items);
  },
  async add(category, content) {
    const page = await notionApi('/pages', {
      method: 'POST',
      body: {
        parent: { database_id: NOTION_DB_ID },
        properties: {
          [NP.title]: { title: [{ text: { content } }] },
          [NP.category]: { select: { name: category } },
          [NP.done]: { checkbox: false },
        },
      },
    });
    return mapNotionTodo(page);
  },
  async update(id, { done, content }) {
    const properties = {};
    if (typeof done === 'boolean') properties[NP.done] = { checkbox: done };
    if (typeof content === 'string') properties[NP.title] = { title: [{ text: { content } }] };
    try {
      const page = await notionApi(`/pages/${id}`, { method: 'PATCH', body: { properties } });
      return mapNotionTodo(page);
    } catch (err) {
      if (err.status === 404 || err.status === 400) return null; // 없는/잘못된 id
      throw err;
    }
  },
  async remove(id) {
    try {
      // 노션 API 는 하드 삭제가 없다 → 보관(archive)하면 DB 뷰에서 사라진다.
      await notionApi(`/pages/${id}`, { method: 'PATCH', body: { archived: true } });
      return id;
    } catch (err) {
      if (err.status === 404 || err.status === 400) return null;
      throw err;
    }
  },
};

const pgTodos = {
  async list() {
    const { rows } = await pool.query(
      `SELECT id, category, content, done, created_at
         FROM cafe_todos
        ORDER BY done ASC, created_at DESC, id DESC`
    );
    return rows.map((r) => ({
      id: String(r.id),
      category: r.category,
      content: r.content,
      done: r.done === true,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }));
  },
  async add(category, content) {
    const { rows } = await pool.query(
      `INSERT INTO cafe_todos (category, content) VALUES ($1, $2)
       RETURNING id, category, content, done, created_at`,
      [category, content]
    );
    const r = rows[0];
    return { id: String(r.id), category: r.category, content: r.content, done: r.done === true, createdAt: r.created_at };
  },
  async update(id, { done, content }) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    const sets = [];
    const params = [];
    if (typeof done === 'boolean') { params.push(done); sets.push(`done = $${params.length}`); }
    if (typeof content === 'string') { params.push(content); sets.push(`content = $${params.length}`); }
    params.push(n);
    const { rows } = await pool.query(
      `UPDATE cafe_todos SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, category, content, done, created_at`,
      params
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { id: String(r.id), category: r.category, content: r.content, done: r.done === true, createdAt: r.created_at };
  },
  async remove(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    const { rows } = await pool.query('DELETE FROM cafe_todos WHERE id = $1 RETURNING id', [n]);
    return rows.length ? String(rows[0].id) : null;
  },
};

// 원본 선택: 노션 토큰이 있으면 노션, 없으면 Postgres.
const todosBackend = USE_NOTION ? notionTodos : pgTodos;

// 노션 미연결 등 설정 오류를 프런트에서 알아볼 수 있게 메시지를 다듬는다.
function todosFail(res, err, fallback) {
  console.error(err.message);
  if (USE_NOTION && err.notion && err.notion.code === 'object_not_found') {
    return res.status(502).json({
      success: false,
      message:
        '노션 DB에 접근할 수 없습니다. Notion에서 통합 "GEONWOO RYU"를 “놀담 카페 · 할일 & 발주 메모” DB의 ··· → Connections 에 연결했는지 확인해주세요.',
    });
  }
  return res.status(500).json({ success: false, message: fallback });
}

// 할일/발주 목록(노션 URL 포함).
async function getTodos() {
  const items = await todosBackend.list();
  return { notionUrl: NOTION_MEMO_URL, items };
}

// ------------------------------------------------------------
// 카페 라우트 (모두 인증 필요)
// ------------------------------------------------------------
app.get('/api/cafe/config', requireAuth, async (_req, res) => {
  try {
    const { today } = seoulToday();
    const { rows } = await pool.query(`SELECT to_char(max(sale_date),'YYYY-MM-DD') dt FROM cafe_daily_sales`);
    res.json({
      success: true,
      data: {
        cafeName: CAFE.name, concept: CAFE.concept, location: CAFE.location,
        notionUrl: NOTION_MEMO_URL, today, dataThrough: rows[0].dt,
      },
    });
  } catch (err) {
    console.error('GET /api/cafe/config:', err.message);
    res.status(500).json({ success: false, message: '설정 정보를 불러오지 못했습니다.' });
  }
});

app.get('/api/cafe/summary', requireAuth, async (_req, res) => {
  try {
    const data = await getSummaryData();
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/cafe/summary:', err.message);
    res.status(500).json({ success: false, message: '대시보드 요약을 불러오지 못했습니다.' });
  }
});

app.get('/api/cafe/weather', requireAuth, async (_req, res) => {
  try {
    const data = await getWeatherPrediction();
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/cafe/weather:', err.message);
    res.status(500).json({ success: false, message: '날씨·예측 정보를 불러오지 못했습니다.' });
  }
});

// ---- 할일/발주 메모 CRUD (원본: USE_NOTION ? 노션 DB : Postgres) ----
app.get('/api/cafe/todos', requireAuth, async (_req, res) => {
  try {
    const data = await getTodos();
    res.json({ success: true, data });
  } catch (err) {
    todosFail(res, err, '메모를 불러오지 못했습니다.');
  }
});

app.post('/api/cafe/todos', requireAuth, async (req, res) => {
  try {
    const category = req.body && typeof req.body.category === 'string' ? req.body.category.trim() : '';
    const content = req.body && typeof req.body.content === 'string' ? req.body.content.trim() : '';

    if (!TODO_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "구분은 '할일' 또는 '발주'여야 합니다." });
    }
    if (!content) {
      return res.status(400).json({ success: false, message: '내용을 입력해주세요.' });
    }

    const item = await todosBackend.add(category, content);
    res.status(201).json({ success: true, data: { item } });
  } catch (err) {
    todosFail(res, err, '메모를 추가하지 못했습니다.');
  }
});

app.patch('/api/cafe/todos/:id', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: '잘못된 메모 번호입니다.' });
    }

    const patch = {};
    if (req.body && typeof req.body.done === 'boolean') patch.done = req.body.done;
    if (req.body && typeof req.body.content === 'string') {
      const content = req.body.content.trim();
      if (!content) return res.status(400).json({ success: false, message: '내용은 비울 수 없습니다.' });
      patch.content = content;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: '변경할 내용이 없습니다.' });
    }

    const item = await todosBackend.update(id, patch);
    if (!item) {
      return res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: { item } });
  } catch (err) {
    todosFail(res, err, '메모를 수정하지 못했습니다.');
  }
});

app.delete('/api/cafe/todos/:id', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: '잘못된 메모 번호입니다.' });
    }
    const removed = await todosBackend.remove(id);
    if (!removed) {
      return res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: { id: removed } });
  } catch (err) {
    todosFail(res, err, '메모를 삭제하지 못했습니다.');
  }
});

// ------------------------------------------------------------
// AI 오늘의 브리핑
// ------------------------------------------------------------
// 오늘(서버 날짜) 메모리 캐시로 재과금 방지. { date, data }.
let briefingCache = null;

const BRIEFING_SYSTEM =
  '너는 놀담(파주 키즈 브런치 카페) 데이터 분석 비서다. 사장님께 오늘 아침 브리핑을 따뜻하고 간결하게 전한다. 숫자는 근거로만 쓰고 과장 금지. 반드시 JSON 으로만 답한다.';
const BRIEFING_KEYS = ['headline', 'salesReview', 'prediction', 'inventoryAction', 'todoReminder', 'oneLiner'];

// summary + weather/prediction + 미완료 todos 를 압축 컨텍스트로. OpenAI/폴백이 같은 숫자를 쓰게 한다.
function buildBriefingContext(summary, wp, openTodos, today) {
  const k = summary.kpi;
  const p = wp.prediction;
  const w = wp.weather;
  const lowStock = summary.inventory.items
    .filter((i) => i.status === '부족')
    .map((i) => ({ name: i.name, current: i.current, safety: i.safety, unit: i.unit, shortage: i.shortage }));

  return {
    cafe: CAFE.name, concept: CAFE.concept, location: CAFE.location, today,
    yesterday: {
      date: k.latestDate, dow: k.latestDow, revenue: k.latestRevenue, customers: k.latestCustomers,
      qty: k.latestQty, prevRevenue: k.prevRevenue, prevCustomers: k.prevCustomers,
      revenueDelta: k.latestRevenue - k.prevRevenue,
    },
    month: {
      label: k.monthLabel, revenue: k.monthRevenue, customers: k.monthCustomers, days: k.monthDays,
      prevLabel: k.prevMonthLabel, prevRevenue: k.prevMonthRevenue, delta: k.monthRevenue - k.prevMonthRevenue,
    },
    today_forecast: {
      dow: p.dow, isWeekend: p.isWeekend, baseline: p.baseline, predicted: p.predicted,
      low: p.low, high: p.high, multiplier: p.weatherMultiplier,
      weatherAvailable: w.available, weatherDesc: w.available ? w.desc : null, temp: w.available ? w.temp : null,
    },
    topMenus: summary.topMenus.slice(0, 3).map((m) => ({ name: m.name, qty: m.qty })),
    lowStock,
    openTodos: openTodos.slice(0, 6).map((t) => ({ category: t.category, content: t.content })),
  };
}

// OpenAI 실패/키 없음 시 같은 숫자로 결정적 한국어 브리핑(대시보드가 항상 뭔가 표시하도록).
function fallbackBriefing(c) {
  const y = c.yesterday, m = c.month, f = c.today_forecast;
  const deltaTxt =
    y.revenueDelta > 0 ? `전일 대비 +${won(y.revenueDelta)}원`
    : y.revenueDelta < 0 ? `전일 대비 ${won(y.revenueDelta)}원`
    : '전일과 비슷한 수준';

  const headline = `☕ ${y.date || c.today}(${y.dow || '-'}) 놀담 아침 브리핑`;
  const salesReview = `어제는 매출 ${won(y.revenue)}원, 방문 ${y.customers}명(${y.qty}잔·개 판매)을 기록했어요. ${deltaTxt}입니다.`;

  let prediction = `오늘(${f.dow}요일)은 약 ${f.predicted}명(${f.low}~${f.high}명) 방문이 예상돼요.`;
  if (f.weatherAvailable && f.weatherDesc) {
    prediction += ` 파주 날씨는 ${f.weatherDesc}${f.temp != null ? `, ${Math.round(f.temp)}°C` : ''}입니다.`;
  } else {
    prediction += ' (날씨 API 활성화 대기 중 — 요일 평균 기반 예측)';
  }

  const inventoryAction = c.lowStock.length > 0
    ? `재고 부족 ${c.lowStock.length}건: ${c.lowStock.slice(0, 3).map((s) => `${s.name}(${s.current}/${s.safety}${s.unit})`).join(', ')}. 오늘 발주를 챙겨주세요.`
    : '재고는 모두 안전 수준이에요. 오늘은 발주 걱정 없이 운영하셔도 좋아요.';

  const todoReminder = c.openTodos.length > 0
    ? `오늘 할일·발주 ${c.openTodos.length}건이 남아 있어요. 예: ${c.openTodos.slice(0, 2).map((t) => t.content).join(' / ')}.`
    : '등록된 할일이 없어요. 오늘의 할일을 추가해보세요.';

  const oneLiner = '주말 가족손님 맞이 준비, 오늘도 놀담답게 따뜻하게 시작해요! 🌿';
  return { headline, salesReview, prediction, inventoryAction, todoReminder, oneLiner };
}

// 6키 모두 비어있지 않은 문자열로 보정(부족분은 폴백에서 채움).
function normalizeBriefing(raw, context) {
  const fb = fallbackBriefing(context);
  const out = {};
  for (const key of BRIEFING_KEYS) {
    const v = raw && raw[key];
    out[key] = typeof v === 'string' && v.trim() ? v.trim() : fb[key];
  }
  return out;
}

async function callOpenAI(context) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 없음');
  const userPrompt =
    `아래는 오늘 아침 놀담 카페의 운영 데이터(JSON)야.\n${JSON.stringify(context)}\n\n` +
    '다음 키만 담은 JSON 객체로 답해줘: ' +
    'headline(한 줄 헤드라인), salesReview(어제 매출/방문 요약 1~2문장), prediction(오늘 손님수 예측/날씨 1문장), ' +
    'inventoryAction(재고 부족·발주 권고 1문장), todoReminder(오늘 할일 상기 1문장), oneLiner(응원 한마디). ' +
    '각 값은 한국어 문자열. 숫자는 데이터에 있는 값만 사용하고 지어내지 마.';

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.6,
      messages: [
        { role: 'system', content: BRIEFING_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try { const eb = await resp.json(); if (eb && eb.error && eb.error.message) detail = eb.error.message; } catch (_e) { /* ignore */ }
    throw new Error(`OpenAI 오류: ${detail}`);
  }
  const j = await resp.json();
  const text = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
  return JSON.parse(text || '{}');
}

// 브리핑 생성(캐시 갱신 포함). OpenAI 실패해도 폴백으로 항상 success 데이터를 만든다.
async function generateBriefing() {
  const { today } = seoulToday();
  // 노션 미연결/일시장애로 메모를 못 읽어도 브리핑은 죽지 않게 빈 목록으로 폴백.
  const [summary, wp, todosData] = await Promise.all([
    getSummaryData(),
    getWeatherPrediction(),
    getTodos().catch((err) => {
      console.error('briefing getTodos:', err.message);
      return { notionUrl: NOTION_MEMO_URL, items: [] };
    }),
  ]);
  const openTodos = todosData.items.filter((t) => !t.done);
  const context = buildBriefingContext(summary, wp, openTodos, today);

  let briefing;
  let model;
  try {
    const raw = await callOpenAI(context);
    briefing = normalizeBriefing(raw, context);
    model = OPENAI_MODEL;
  } catch (err) {
    console.error('브리핑 OpenAI 실패 → 폴백 사용:', err.message);
    briefing = fallbackBriefing(context);
    model = 'fallback';
  }

  const data = { date: today, model, generatedAt: new Date().toISOString(), cached: false, briefing };
  briefingCache = { date: today, data };
  return data;
}

app.get('/api/cafe/briefing', requireAuth, async (_req, res) => {
  try {
    const { today } = seoulToday();
    if (briefingCache && briefingCache.date === today) {
      return res.json({ success: true, data: { ...briefingCache.data, cached: true } });
    }
    const data = await generateBriefing();
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/cafe/briefing:', err.message);
    res.status(500).json({ success: false, message: '브리핑을 불러오지 못했습니다.' });
  }
});

app.post('/api/cafe/briefing/refresh', requireAuth, async (_req, res) => {
  try {
    const data = await generateBriefing(); // 캐시 무시하고 강제 재생성
    res.json({ success: true, data });
  } catch (err) {
    console.error('POST /api/cafe/briefing/refresh:', err.message);
    res.status(500).json({ success: false, message: '브리핑을 새로고침하지 못했습니다.' });
  }
});

// ------------------------------------------------------------
// 알 수 없는 /api → JSON 404. 그 외 GET → index.html(SPA fallback).
// ------------------------------------------------------------
app.use('/api', (_req, res) => res.status(404).json({ success: false, message: '존재하지 않는 API 경로입니다.' }));

// Express 4 기준 정규식 fallback: /api/ 로 시작하지 않는 모든 경로.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'index.html'), (err) => {
    if (err && !res.headersSent) {
      res.status(404).send('index.html 을 찾을 수 없습니다. (프론트가 아직 배치되지 않았습니다)');
    }
  });
});

// ------------------------------------------------------------
// 로컬: 서버 시작 / 서버리스(Vercel): app export
// ------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`놀담 카페 대시보드 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
