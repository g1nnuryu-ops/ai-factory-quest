// ─────────────────────────────────────────────────────────────────────────────
// seed_cafe_db.js — 일반 카페 운영 데이터 생성 & Supabase(PostgreSQL) 적재
//
// 생성 데이터 (기간: 2026-01-01 ~ 2026-07-02, 총 183일)
//   1) cafe_menu            메뉴 마스터 (22종: 커피/논커피/디저트/브런치)
//   2) cafe_daily_sales     일별 매출 집계 (요일/주말/방문객수/판매수량/매출)
//   3) cafe_menu_sales      일별 × 메뉴별 판매량 (판매수량/매출)
//   4) cafe_inventory       재고 품목 마스터 + 현재고(2026-07-02 기준)/안전재고/단가
//   5) cafe_purchase_orders 발주 이력 (품목/수량/단가/총액/입고일/상태)
//
// 공용 Supabase 를 다른 quest 앱과 공유하므로 테이블명에 cafe_ 접두사를 붙인다.
// (가계부 앱: ledger_ , 이 앱: cafe_ )
// 재실행해도 동일 결과가 되도록 시드 고정 PRNG 사용 + 시작 시 cafe_* 테이블만 DROP 후 재생성.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
// week_5 공유 .env 에 DATABASE_URL 이 있다.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ── 재현 가능한 난수(seeded) ─────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260702);
const rnd = (min, max) => min + (max - min) * rand();

// ── 날짜 헬퍼 (UTC 고정: 타임존 밀림 방지) ───────────────────────────────────
const START = Date.UTC(2026, 0, 1);   // 2026-01-01
const END = Date.UTC(2026, 6, 2);     // 2026-07-02
const DAY_MS = 86400000;
const TOTAL_DAYS = Math.round((END - START) / DAY_MS) + 1; // 183
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// ── 메뉴 마스터 [id, 이름, 카테고리, 판매가, 원가, 인기가중치, 온도성향] ─────
const MENUS = [
  [1, '아메리카노', '커피', 4500, 1300, 22, 'neutral'],
  [2, '카페라떼', '커피', 5000, 1600, 16, 'warm'],
  [3, '카푸치노', '커피', 5000, 1600, 6, 'warm'],
  [4, '바닐라라떼', '커피', 5500, 1800, 8, 'warm'],
  [5, '카페모카', '커피', 5500, 1900, 6, 'warm'],
  [6, '콜드브루', '커피', 5000, 1500, 7, 'cold'],
  [7, '에스프레소', '커피', 4000, 1100, 3, 'neutral'],
  [8, '녹차라떼', '논커피', 5500, 1800, 5, 'warm'],
  [9, '초코라떼', '논커피', 5500, 1900, 4, 'warm'],
  [10, '딸기라떼', '논커피', 6000, 2100, 5, 'neutral'],
  [11, '자몽에이드', '논커피', 6000, 2000, 5, 'cold'],
  [12, '레몬에이드', '논커피', 6000, 2000, 5, 'cold'],
  [13, '아이스티', '논커피', 4500, 1200, 5, 'cold'],
  [14, '치즈케이크', '디저트', 6500, 2500, 5, 'neutral'],
  [15, '티라미수', '디저트', 6500, 2500, 4, 'neutral'],
  [16, '크로플', '디저트', 6000, 2200, 5, 'neutral'],
  [17, '마카롱', '디저트', 3000, 1100, 6, 'neutral'],
  [18, '스콘', '디저트', 4000, 1400, 4, 'neutral'],
  [19, '크루아상', '디저트', 4500, 1600, 5, 'neutral'],
  [20, '샌드위치', '브런치', 8500, 3500, 4, 'neutral'],
  [21, '아보카도토스트', '브런치', 9000, 3800, 3, 'neutral'],
  [22, '리코타팬케이크', '브런치', 12000, 4500, 3, 'neutral'],
];

// 월별 성장계수 (오픈 후 램프업: 겨울 낮고 초여름까지 상승 후 안정)
const MONTH_FACTOR = { 1: 0.80, 2: 0.88, 3: 1.00, 4: 1.10, 5: 1.20, 6: 1.28, 7: 1.30 };

// 계절 보정 (month-1 인덱스): 따뜻한 음료는 겨울↑, 시원한 음료는 여름↑
const SEASON = {
  warm: [1.20, 1.15, 1.05, 1.00, 0.92, 0.85, 0.82],
  cold: [0.72, 0.75, 0.90, 1.00, 1.15, 1.30, 1.35],
  neutral: [1, 1, 1, 1, 1, 1, 1],
};

const BASE_ITEMS_WD = 150;    // 평일 기준 일 판매 아이템 수(1월 수준)
const ITEMS_PER_CUSTOMER = 1.85; // 1인당 평균 구매 개수(음료+가끔 디저트)

// ── 일별 매출 + 메뉴별 판매량 생성 ───────────────────────────────────────────
const dailyRows = [];   // [sale_date, dow, is_weekend, customer_count, total_qty, total_revenue]
const menuSalesRows = []; // [sale_date, menu_id, qty, revenue]

for (let ms = START; ms <= END; ms += DAY_MS) {
  const date = fmt(ms);
  const wday = new Date(ms).getUTCDay();       // 0=일 … 6=토
  const month = new Date(ms).getUTCMonth() + 1;
  const isWeekend = wday === 0 || wday === 6;

  const dowMult = isWeekend ? 1.45 : wday === 5 ? 1.12 : 1.0; // 주말↑, 금요일 소폭↑
  const T = BASE_ITEMS_WD * MONTH_FACTOR[month] * dowMult * rnd(0.90, 1.12);

  // 메뉴별 유효 가중치(계절 + 소폭 노이즈)
  const eff = MENUS.map(m => m[5] * SEASON[m[6]][month - 1] * rnd(0.9, 1.1));
  const sumEff = eff.reduce((a, b) => a + b, 0);

  let dayQty = 0, dayRev = 0;
  MENUS.forEach((m, i) => {
    const qty = Math.round((T * eff[i]) / sumEff);
    if (qty <= 0) return;                 // 그날 안 팔린 메뉴는 행 생략(실제 판매만 기록)
    const rev = qty * m[3];
    menuSalesRows.push([date, m[0], qty, rev]);
    dayQty += qty;
    dayRev += rev;
  });

  const customers = Math.max(1, Math.round(dayQty / ITEMS_PER_CUSTOMER));
  dailyRows.push([date, DOW[wday], isWeekend, customers, dayQty, dayRev]);
}

// ── 재고 품목 마스터 [id,이름,분류,단위,단가,안전재고,현재고(07-02)] ─────────
const INVENTORY = [
  [1, '원두-에스프레소', '원두', 'kg', 25000, 8, 12],
  [2, '원두-콜드브루', '원두', 'kg', 22000, 4, 3],   // 부족
  [3, '우유', '유제품', 'L', 1200, 40, 55],
  [4, '오트밀크', '유제품', 'L', 2500, 10, 8],        // 부족
  [5, '생크림', '유제품', 'L', 4000, 6, 9],
  [6, '크림치즈', '유제품', 'kg', 9000, 3, 5],
  [7, '밀가루', '베이킹', 'kg', 1500, 10, 14],
  [8, '버터', '베이킹', 'kg', 12000, 4, 6],
  [9, '설탕', '베이킹', 'kg', 1800, 8, 11],
  [10, '바닐라시럽', '시럽', '병', 8000, 4, 6],
  [11, '초코소스', '시럽', '병', 7000, 3, 4],
  [12, '딸기시럽', '시럽', '병', 8500, 3, 2],         // 부족
  [13, '종이컵', '부자재', '개', 60, 500, 820],
  [14, '컵뚜껑', '부자재', '개', 40, 500, 640],
  [15, '홀더', '부자재', '개', 30, 300, 450],
  [16, '빨대', '부자재', '개', 10, 500, 380],         // 부족
  [17, '냅킨', '부자재', '매', 5, 1000, 1500],
  [18, '캐리어', '부자재', '개', 120, 200, 260],
];

// ── 발주 이력 생성 ───────────────────────────────────────────────────────────
// [item_id, 발주주기(일), 기본수량, 리드타임(일), 반올림단위]
const PO_PLAN = [
  [3, 3, 38, 1, 1],       // 우유
  [4, 7, 8, 1, 1],        // 오트밀크
  [5, 5, 6, 1, 1],        // 생크림
  [6, 7, 4, 1, 1],        // 크림치즈
  [1, 5, 8, 2, 1],        // 원두-에스프레소
  [2, 7, 4, 2, 1],        // 원두-콜드브루
  [7, 7, 10, 1, 1],       // 밀가루
  [8, 10, 4, 1, 1],       // 버터
  [9, 14, 10, 2, 1],      // 설탕
  [10, 14, 5, 2, 1],      // 바닐라시럽
  [11, 14, 4, 2, 1],      // 초코소스
  [12, 14, 4, 2, 1],      // 딸기시럽
  [13, 14, 1000, 3, 100], // 종이컵
  [14, 14, 1000, 3, 100], // 컵뚜껑
  [15, 21, 500, 3, 50],   // 홀더
  [16, 21, 1000, 3, 100], // 빨대
  [17, 21, 2000, 3, 100], // 냅킨
  [18, 21, 300, 3, 50],   // 캐리어
];
const invById = Object.fromEntries(INVENTORY.map(r => [r[0], r]));
const poRows = []; // [order_date, item_id, order_qty, unit_cost, total_cost, delivered_date, status]
for (const [itemId, every, baseQty, lead, roundTo] of PO_PLAN) {
  const baseCost = invById[itemId][4];
  const offset = (itemId * 3) % every; // 품목마다 시작일 분산
  for (let d = offset; d < TOTAL_DAYS; d += every) {
    const orderMs = START + d * DAY_MS;
    const month = new Date(orderMs).getUTCMonth() + 1;
    const qty = Math.max(roundTo,
      Math.round((baseQty * MONTH_FACTOR[month] * rnd(0.9, 1.1)) / roundTo) * roundTo);
    const unitCost = Math.round(baseCost * rnd(0.98, 1.04)); // 시세 변동
    const total = qty * unitCost;
    const delivMs = orderMs + lead * DAY_MS;
    const status = delivMs <= END ? '입고완료' : '발주';
    poRows.push([fmt(orderMs), itemId, qty, unitCost, total,
      delivMs <= END ? fmt(delivMs) : null, status]);
  }
}
poRows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

// ── DDL: cafe_* 테이블만 재생성 ──────────────────────────────────────────────
const DDL = `
DROP TABLE IF EXISTS cafe_menu_sales CASCADE;
DROP TABLE IF EXISTS cafe_purchase_orders CASCADE;
DROP TABLE IF EXISTS cafe_daily_sales CASCADE;
DROP TABLE IF EXISTS cafe_inventory CASCADE;
DROP TABLE IF EXISTS cafe_menu CASCADE;

CREATE TABLE cafe_menu (
  id       INT PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT NOT NULL,
  price    INT  NOT NULL,
  cost     INT  NOT NULL
);
CREATE TABLE cafe_daily_sales (
  sale_date      DATE PRIMARY KEY,
  day_of_week    TEXT    NOT NULL,
  is_weekend     BOOLEAN NOT NULL,
  customer_count INT     NOT NULL,
  total_qty      INT     NOT NULL,
  total_revenue  INT     NOT NULL
);
CREATE TABLE cafe_menu_sales (
  id        BIGSERIAL PRIMARY KEY,
  sale_date DATE NOT NULL REFERENCES cafe_daily_sales(sale_date),
  menu_id   INT  NOT NULL REFERENCES cafe_menu(id),
  qty       INT  NOT NULL,
  revenue   INT  NOT NULL,
  UNIQUE (sale_date, menu_id)
);
CREATE TABLE cafe_inventory (
  id            INT PRIMARY KEY,
  item_name     TEXT    NOT NULL,
  category      TEXT    NOT NULL,
  unit          TEXT    NOT NULL,
  unit_cost     INT     NOT NULL,
  safety_stock  NUMERIC NOT NULL,
  current_stock NUMERIC NOT NULL
);
CREATE TABLE cafe_purchase_orders (
  id             BIGSERIAL PRIMARY KEY,
  order_date     DATE NOT NULL,
  item_id        INT  NOT NULL REFERENCES cafe_inventory(id),
  order_qty      NUMERIC NOT NULL,
  unit_cost      INT  NOT NULL,
  total_cost     INT  NOT NULL,
  delivered_date DATE,
  status         TEXT NOT NULL
);
CREATE INDEX cafe_menu_sales_date_idx ON cafe_menu_sales(sale_date);
CREATE INDEX cafe_menu_sales_menu_idx ON cafe_menu_sales(menu_id);
CREATE INDEX cafe_po_date_idx         ON cafe_purchase_orders(order_date);
`;

// ── 배치 INSERT 헬퍼 ─────────────────────────────────────────────────────────
async function bulkInsert(table, cols, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const tuples = slice.map((r, ri) => {
      const ph = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`);
      r.forEach(v => params.push(v));
      return `(${ph.join(',')})`;
    });
    await pool.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, params);
  }
}

const won = n => Number(n).toLocaleString('ko-KR');

(async () => {
  try {
    console.log('▶ 접속 & 스키마 생성…');
    await pool.query(DDL);

    console.log('▶ 데이터 적재…');
    await bulkInsert('cafe_menu',
      ['id', 'name', 'category', 'price', 'cost'], MENUS.map(m => m.slice(0, 5)));
    await bulkInsert('cafe_daily_sales',
      ['sale_date', 'day_of_week', 'is_weekend', 'customer_count', 'total_qty', 'total_revenue'],
      dailyRows);
    await bulkInsert('cafe_menu_sales',
      ['sale_date', 'menu_id', 'qty', 'revenue'], menuSalesRows);
    await bulkInsert('cafe_inventory',
      ['id', 'item_name', 'category', 'unit', 'unit_cost', 'safety_stock', 'current_stock'],
      INVENTORY);
    await bulkInsert('cafe_purchase_orders',
      ['order_date', 'item_id', 'order_qty', 'unit_cost', 'total_cost', 'delivered_date', 'status'],
      poRows);

    // ── 검증 요약 ──────────────────────────────────────────────────────────
    const counts = await pool.query(`
      SELECT 'cafe_menu' t, count(*) n FROM cafe_menu
      UNION ALL SELECT 'cafe_daily_sales', count(*) FROM cafe_daily_sales
      UNION ALL SELECT 'cafe_menu_sales', count(*) FROM cafe_menu_sales
      UNION ALL SELECT 'cafe_inventory', count(*) FROM cafe_inventory
      UNION ALL SELECT 'cafe_purchase_orders', count(*) FROM cafe_purchase_orders
      ORDER BY t;`);
    console.log('\n■ 테이블별 행 수');
    counts.rows.forEach(r => console.log(`   ${r.t.padEnd(22)} ${r.n}`));

    const span = await pool.query(
      `SELECT to_char(min(sale_date),'YYYY-MM-DD') a, to_char(max(sale_date),'YYYY-MM-DD') b,
              sum(total_revenue) rev, sum(total_qty) qty FROM cafe_daily_sales;`);
    const s = span.rows[0];
    console.log('\n■ 매출 기간/합계');
    console.log(`   기간         ${s.a} ~ ${s.b}`);
    console.log(`   총 매출      ${won(s.rev)} 원`);
    console.log(`   총 판매수량  ${won(s.qty)} 잔/개`);

    const byMonth = await pool.query(`
      SELECT to_char(sale_date,'YYYY-MM') m, sum(total_revenue) rev, sum(total_qty) qty
      FROM cafe_daily_sales GROUP BY 1 ORDER BY 1;`);
    console.log('\n■ 월별 매출');
    byMonth.rows.forEach(r => console.log(`   ${r.m}   ${won(r.rev).padStart(12)} 원   (${won(r.qty)} 개)`));

    const top = await pool.query(`
      SELECT m.name, m.category, sum(s.qty) qty, sum(s.revenue) rev
      FROM cafe_menu_sales s JOIN cafe_menu m ON m.id = s.menu_id
      GROUP BY m.name, m.category ORDER BY qty DESC LIMIT 5;`);
    console.log('\n■ 판매량 TOP5 메뉴');
    top.rows.forEach((r, i) =>
      console.log(`   ${i + 1}. ${r.name.padEnd(8)} ${won(r.qty).padStart(7)}개  ${won(r.rev)}원`));

    const low = await pool.query(`
      SELECT item_name, current_stock, safety_stock, unit
      FROM cafe_inventory WHERE current_stock < safety_stock ORDER BY item_name;`);
    console.log('\n■ 재고 부족(재발주 필요) 품목');
    low.rows.forEach(r =>
      console.log(`   ⚠ ${r.item_name.padEnd(14)} 현재고 ${r.current_stock}${r.unit} < 안전 ${r.safety_stock}${r.unit}`));

    console.log('\n✅ 완료.');
  } catch (e) {
    console.error('❌ 오류:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
