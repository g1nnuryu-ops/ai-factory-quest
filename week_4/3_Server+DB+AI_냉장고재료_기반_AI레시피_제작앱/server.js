// ============================================================
// 냉장고 식재료 관리 + AI 레시피/식단 제작 — API server
// Express + PostgreSQL(Supabase) + OpenAI.
//   - 2번 식재료 관리 앱을 기반으로 확장: 식재료 CRUD 를 이 앱에 내장한다.
//   - 같은 DB(DATABASE_URL 공유)의 ingredients 를 관리하고, AI 입력으로 사용한다.
//   - AI 단일 레시피 / 주간·월간 식단을 "생성(미리보기)" 후 사용자가 저장한다.
//   - 프론트엔드는 단일 index.html(인라인 React) + 이 server.js.
// ============================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase 는 SSL 필요. .trim() 으로 개행 방어.
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ------------------------------------------------------------
// 입력 정규화 헬퍼
// ------------------------------------------------------------
const asArray = (v) => (Array.isArray(v) ? v : []);
const asString = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
const asNumber = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const asNullableNumber = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(asNumber(v, lo))));
const slugify = (s) => asString(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function httpError(status, message) { const e = new Error(message); e.status = status; e.publicMessage = message; return e; }

// ============================================================
// 🌱 식재료 시드 (24종) — DB가 비어 있을 때 1회 주입(2번 앱과 동일).
// ============================================================
const SEED_INGREDIENTS = [
  { id:'egg', 이름:'계란', 영문명:'Egg', 수량:10, 단위:'개', 카테고리:'단백질·달걀', 보관방법:'냉장', 보관위치:'냉장실 안쪽 선반', 소비기한_일:18, 알레르기:['난류'], 아이선호도:5, 주요영양소:['단백질','비타민D','콜린','철분'], 대표요리:['계란말이','계란찜','계란국','스크램블에그'], 비고:'유아 단백질 공급의 핵심. 뾰족한 부분이 아래로.' },
  { id:'milk', 이름:'우유', 영문명:'Milk', 수량:2, 단위:'팩(900mL)', 카테고리:'유제품', 보관방법:'냉장', 보관위치:'냉장실 안쪽', 소비기한_일:3, 알레르기:['우유'], 아이선호도:5, 주요영양소:['칼슘','단백질','비타민D'], 대표요리:['우유','시리얼','베샤멜소스','스무디'], 비고:'개봉 후 빨리 소비.' },
  { id:'tofu', 이름:'두부', 영문명:'Tofu', 수량:1, 단위:'모(300g)', 카테고리:'콩가공품', 보관방법:'냉장', 보관위치:'냉장실', 소비기한_일:7, 알레르기:['대두'], 아이선호도:4, 주요영양소:['식물성단백질','칼슘','이소플라본'], 대표요리:['두부조림','두부부침','된장찌개','두부스테이크'], 비고:'부드러워 유아식에 적합.' },
  { id:'kimchi', 이름:'배추김치', 영문명:'Kimchi', 수량:1, 단위:'통(1kg)', 카테고리:'발효식품·채소', 보관방법:'냉장', 보관위치:'김치냉장고', 소비기한_일:90, 알레르기:['새우'], 아이선호도:2, 주요영양소:['유산균','식이섬유','비타민C'], 대표요리:['김치찌개','김치볶음밥','김치전'], 비고:'아이용은 헹궈 매운맛을 덜어 사용.' },
  { id:'carrot', 이름:'당근', 영문명:'Carrot', 수량:3, 단위:'개', 카테고리:'채소(뿌리채소)', 보관방법:'냉장', 보관위치:'채소칸', 소비기한_일:25, 알레르기:[], 아이선호도:3, 주요영양소:['베타카로틴','비타민A','식이섬유'], 대표요리:['당근볶음','카레','볶음밥','당근라페'], 비고:'잘게 다져 볶음밥·계란요리에 섞으면 거부감 적음.' },
  { id:'spinach', 이름:'시금치', 영문명:'Spinach', 수량:1, 단위:'단', 카테고리:'채소(엽채류)', 보관방법:'냉장', 보관위치:'채소칸(세워서)', 소비기한_일:3, 알레르기:[], 아이선호도:2, 주요영양소:['철분','엽산','비타민K'], 대표요리:['시금치나물','된장국','시금치무침','계란말이'], 비고:'금방 무르므로 빨리 사용.' },
  { id:'green-onion', 이름:'대파', 영문명:'Green Onion', 수량:1, 단위:'단', 카테고리:'채소(향신채소)', 보관방법:'냉장', 보관위치:'채소칸 또는 냉동', 소비기한_일:14, 알레르기:[], 아이선호도:2, 주요영양소:['알리신','비타민C','식이섬유'], 대표요리:['파국','계란말이','파기름'], 비고:'송송 썰어 냉동하면 오래 사용.' },
  { id:'pork', 이름:'돼지고기(앞다리살)', 영문명:'Pork (Front Leg)', 수량:500, 단위:'g', 카테고리:'육류', 보관방법:'냉장(단기)·냉동(장기)', 보관위치:'냉장 육류칸/냉동', 소비기한_일:3, 알레르기:['돼지고기'], 아이선호도:4, 주요영양소:['단백질','비타민B1','철분'], 대표요리:['제육볶음(순한맛)','돼지고기조림','카레'], 비고:'1회분씩 소분 냉동.' },
  { id:'chicken', 이름:'닭고기(닭다리살)', 영문명:'Chicken (Thigh)', 수량:500, 단위:'g', 카테고리:'육류', 보관방법:'냉장(단기)·냉동(장기)', 보관위치:'냉장 육류칸/냉동', 소비기한_일:2, 알레르기:['닭고기'], 아이선호도:5, 주요영양소:['단백질','비타민B6','나이아신'], 대표요리:['닭볶음탕(순한맛)','닭갈비','데리야끼치킨','닭죽'], 비고:'아이들이 매우 선호. 우유에 재우면 부드러워짐.' },
  { id:'cheese', 이름:'슬라이스 치즈(아기치즈)', 영문명:'Sliced Cheese', 수량:10, 단위:'장', 카테고리:'유제품', 보관방법:'냉장', 보관위치:'냉장실', 소비기한_일:30, 알레르기:['우유'], 아이선호도:5, 주요영양소:['칼슘','단백질'], 대표요리:['치즈계란말이','치즈김밥','치즈토스트'], 비고:'유아용은 나트륨 낮은 아기치즈.' },
  { id:'yogurt', 이름:'플레인 요거트', 영문명:'Plain Yogurt', 수량:4, 단위:'개', 카테고리:'유제품', 보관방법:'냉장', 보관위치:'냉장실', 소비기한_일:11, 알레르기:['우유'], 아이선호도:5, 주요영양소:['유산균','칼슘','단백질'], 대표요리:['과일요거트','요거트볼','스무디'], 비고:'무가당 플레인에 과일을 곁들이면 건강 간식.' },
  { id:'apple', 이름:'사과', 영문명:'Apple', 수량:5, 단위:'개', 카테고리:'과일', 보관방법:'냉장', 보관위치:'채소칸(개별 포장)', 소비기한_일:21, 알레르기:[], 아이선호도:5, 주요영양소:['식이섬유','비타민C','펙틴'], 대표요리:['생과일','사과주스','사과조림'], 비고:'에틸렌가스 주의. 아이 간식 1순위.' },
  { id:'strawberry', 이름:'딸기', 영문명:'Strawberry', 수량:1, 단위:'팩(500g)', 카테고리:'과일', 보관방법:'냉장', 보관위치:'냉장실(씻지 않고)', 소비기한_일:2, 알레르기:[], 아이선호도:5, 주요영양소:['비타민C','안토시아닌','엽산'], 대표요리:['생과일','딸기우유','스무디'], 비고:'먹기 직전 세척. 디저트로 인기.' },
  { id:'king-oyster-mushroom', 이름:'새송이버섯', 영문명:'King Oyster Mushroom', 수량:2, 단위:'개', 카테고리:'버섯', 보관방법:'냉장', 보관위치:'채소칸', 소비기한_일:10, 알레르기:[], 아이선호도:3, 주요영양소:['식이섬유','비타민D','칼륨'], 대표요리:['버섯볶음','잡채','버섯전'], 비고:'고기 대체 식감. 씻지 말고 닦아 보관.' },
  { id:'onion', 이름:'양파', 영문명:'Onion', 수량:5, 단위:'개', 카테고리:'채소(양념채소)', 보관방법:'실온', 보관위치:'서늘하고 통풍되는 곳', 소비기한_일:30, 알레르기:[], 아이선호도:2, 주요영양소:['퀘르세틴','알리신','식이섬유'], 대표요리:['볶음·국·찌개','카레','양파볶음'], 비고:'충분히 볶으면 단맛. 감자와 분리.' },
  { id:'garlic', 이름:'마늘', 영문명:'Garlic', 수량:1, 단위:'통(다진마늘 200g)', 카테고리:'채소(향신채소)', 보관방법:'실온·냉장/냉동', 보관위치:'다진마늘은 소분 냉동', 소비기한_일:30, 알레르기:[], 아이선호도:2, 주요영양소:['알리신','셀레늄','비타민B6'], 대표요리:['한식 양념 전반','갈릭버터'], 비고:'유아식엔 소량만.' },
  { id:'potato', 이름:'감자', 영문명:'Potato', 수량:5, 단위:'개', 카테고리:'채소(서류)', 보관방법:'실온', 보관위치:'어둡고 서늘한 곳', 소비기한_일:30, 알레르기:[], 아이선호도:4, 주요영양소:['탄수화물','비타민C','칼륨'], 대표요리:['감자조림','감자국','감자전','으깬감자'], 비고:'싹·녹색 부분 제거. 양파와 분리.' },
  { id:'rice', 이름:'쌀', 영문명:'Rice', 수량:10, 단위:'kg', 카테고리:'곡류·주식', 보관방법:'실온', 보관위치:'밀폐 쌀통', 소비기한_일:180, 알레르기:[], 아이선호도:4, 주요영양소:['탄수화물','단백질'], 대표요리:['밥','죽','볶음밥','주먹밥'], 비고:'가족 주식. 진밥·죽으로 유아식 활용.' },
  { id:'soy-sauce', 이름:'간장', 영문명:'Soy Sauce', 수량:1, 단위:'병(500mL)', 카테고리:'양념(장류)', 보관방법:'실온·냉장(개봉 후)', 보관위치:'개봉 후 냉장', 소비기한_일:365, 알레르기:['대두','밀'], 아이선호도:null, 주요영양소:['나트륨','아미노산'], 대표요리:['조림','무침','볶음','국 간'], 비고:'대두·밀 알레르기 주의. 유아식은 소량.' },
  { id:'sesame-oil', 이름:'참기름', 영문명:'Sesame Oil', 수량:1, 단위:'병(320mL)', 카테고리:'유지·양념', 보관방법:'실온', 보관위치:'빛이 들지 않는 곳', 소비기한_일:180, 알레르기:['참깨'], 아이선호도:null, 주요영양소:['지방','비타민E'], 대표요리:['나물무침','비빔밥','김밥'], 비고:'향이 강해 소량으로 풍미.' },
  { id:'sugar', 이름:'설탕', 영문명:'Sugar', 수량:1, 단위:'봉(1kg)', 카테고리:'양념(조미료)', 보관방법:'실온', 보관위치:'건조한 곳', 소비기한_일:730, 알레르기:[], 아이선호도:null, 주요영양소:['탄수화물'], 대표요리:['단맛 조절','조림','베이킹'], 비고:'유아식은 최소량만.' },
  { id:'cooking-oil', 이름:'식용유', 영문명:'Cooking Oil', 수량:1, 단위:'병(900mL)', 카테고리:'유지·양념', 보관방법:'실온', 보관위치:'서늘한 곳', 소비기한_일:240, 알레르기:[], 아이선호도:null, 주요영양소:['지방'], 대표요리:['볶음','부침','튀김'], 비고:'개봉 후 뚜껑 꼭 닫아 보관.' },
  { id:'seasoned-laver', 이름:'조미김', 영문명:'Seasoned Laver', 수량:1, 단위:'봉(8봉입)', 카테고리:'해조·반찬', 보관방법:'실온', 보관위치:'건조한 곳(밀봉)', 소비기한_일:120, 알레르기:['대두'], 아이선호도:5, 주요영양소:['요오드','식이섬유','미네랄'], 대표요리:['밥 반찬','김밥','주먹밥'], 비고:'아이 밥반찬 단골.' },
  { id:'banana', 이름:'바나나', 영문명:'Banana', 수량:1, 단위:'송이(5~6개)', 카테고리:'과일', 보관방법:'실온', 보관위치:'통풍되는 곳에 걸어서', 소비기한_일:4, 알레르기:[], 아이선호도:5, 주요영양소:['칼륨','식이섬유','비타민B6'], 대표요리:['생과일','바나나우유','팬케이크'], 비고:'실온 보관. 아침·간식으로 인기.' },
];

// ============================================================
// Lazy migration + seed
// ============================================================
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ingredients (
      "id" TEXT PRIMARY KEY, "이름" TEXT NOT NULL DEFAULT '', "영문명" TEXT NOT NULL DEFAULT '',
      "수량" NUMERIC NOT NULL DEFAULT 0, "단위" TEXT NOT NULL DEFAULT '', "카테고리" TEXT NOT NULL DEFAULT '',
      "보관방법" TEXT NOT NULL DEFAULT '', "보관위치" TEXT NOT NULL DEFAULT '', "소비기한_일" INTEGER NOT NULL DEFAULT 0,
      "알레르기" JSONB NOT NULL DEFAULT '[]', "아이선호도" INTEGER, "주요영양소" JSONB NOT NULL DEFAULT '[]',
      "대표요리" JSONB NOT NULL DEFAULT '[]', "비고" TEXT NOT NULL DEFAULT '', "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_recipes (
      "id" TEXT PRIMARY KEY, "제목" TEXT NOT NULL DEFAULT '', "소요시간" TEXT NOT NULL DEFAULT '',
      "인분" TEXT NOT NULL DEFAULT '', "맵기" TEXT NOT NULL DEFAULT '', "아이적합도" INTEGER NOT NULL DEFAULT 3,
      "알레르기" JSONB NOT NULL DEFAULT '[]', "재료" JSONB NOT NULL DEFAULT '[]', "만드는법" JSONB NOT NULL DEFAULT '[]',
      "아이팁" TEXT NOT NULL DEFAULT '', "영양포인트" TEXT NOT NULL DEFAULT '', "사용재료" JSONB NOT NULL DEFAULT '[]',
      "요청옵션" JSONB NOT NULL DEFAULT '{}', "ai_model" TEXT NOT NULL DEFAULT '', "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meal_plans (
      "id" TEXT PRIMARY KEY, "제목" TEXT NOT NULL DEFAULT '', "기간" TEXT NOT NULL DEFAULT '주간',
      "일수" INTEGER NOT NULL DEFAULT 7, "계획" JSONB NOT NULL DEFAULT '[]', "장보기목록" JSONB NOT NULL DEFAULT '[]',
      "비고" TEXT NOT NULL DEFAULT '', "요청옵션" JSONB NOT NULL DEFAULT '{}', "ai_model" TEXT NOT NULL DEFAULT '',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  const ing = await pool.query('SELECT count(*)::int AS n FROM ingredients');
  if (ing.rows[0].n === 0) {
    for (const it of SEED_INGREDIENTS) {
      await pool.query(
        `INSERT INTO ingredients ("id","이름","영문명","수량","단위","카테고리","보관방법","보관위치","소비기한_일","알레르기","아이선호도","주요영양소","대표요리","비고")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14) ON CONFLICT ("id") DO NOTHING`,
        [it.id, it.이름, it.영문명, asNumber(it.수량), it.단위, it.카테고리, it.보관방법, it.보관위치, asNumber(it.소비기한_일),
         JSON.stringify(asArray(it.알레르기)), asNullableNumber(it.아이선호도), JSON.stringify(asArray(it.주요영양소)),
         JSON.stringify(asArray(it.대표요리)), it.비고]
      );
    }
    console.log(`Seeded ${SEED_INGREDIENTS.length} ingredients.`);
  }
  dbInitialized = true;
}

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use('/api', async (_req, res, next) => {
  try { await initDB(); next(); }
  catch (err) { console.error('DB init failed:', err.message); res.status(500).json({ success: false, message: '데이터베이스 초기화에 실패했습니다.' }); }
});

// ============================================================
// 🧊 Ingredients API (full CRUD — 2번 앱 기반)
// ============================================================
const INGREDIENT_COLS = '"id","이름","영문명","수량","단위","카테고리","보관방법","보관위치","소비기한_일","알레르기","아이선호도","주요영양소","대표요리","비고","created_at"';

app.get('/api/ingredients', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${INGREDIENT_COLS} FROM ingredients ORDER BY "소비기한_일" ASC, "id" ASC`);
    res.json({ success: true, data: rows });
  } catch (err) { console.error('GET /api/ingredients:', err.message); res.status(500).json({ success: false, message: '식재료를 불러오지 못했습니다.' }); }
});

app.post('/api/ingredients', async (req, res) => {
  try {
    const b = req.body || {};
    const 이름 = asString(b.이름).trim();
    if (!이름) return res.status(400).json({ success: false, message: '식재료 이름을 입력해 주세요.' });
    const id = asString(b.id).trim() || slugify(b.영문명) || slugify(이름) || `ing_${Date.now().toString(36)}`;
    const { rows } = await pool.query(
      `INSERT INTO ingredients ("id","이름","영문명","수량","단위","카테고리","보관방법","보관위치","소비기한_일","알레르기","아이선호도","주요영양소","대표요리","비고")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14) RETURNING ${INGREDIENT_COLS}`,
      [id, 이름, asString(b.영문명).trim(), asNumber(b.수량), asString(b.단위).trim(), asString(b.카테고리).trim(),
       asString(b.보관방법).trim(), asString(b.보관위치).trim(), asNumber(b.소비기한_일), JSON.stringify(asArray(b.알레르기)),
       asNullableNumber(b.아이선호도), JSON.stringify(asArray(b.주요영양소)), JSON.stringify(asArray(b.대표요리)), asString(b.비고).trim()]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ success: false, message: '이미 같은 ID의 식재료가 있습니다. 다른 영문명을 사용해 주세요.' });
    console.error('POST /api/ingredients:', err.message); res.status(500).json({ success: false, message: '식재료를 추가하지 못했습니다.' });
  }
});

app.patch('/api/ingredients/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const fields = []; const values = []; let i = 1;
    const push = (col, val) => { fields.push(`"${col}" = $${i++}`); values.push(val); };
    const pushJson = (col, val) => { fields.push(`"${col}" = $${i++}::jsonb`); values.push(JSON.stringify(asArray(val))); };
    if ('이름' in b) { const v = asString(b.이름).trim(); if (!v) return res.status(400).json({ success: false, message: '식재료 이름은 비울 수 없습니다.' }); push('이름', v); }
    if ('영문명' in b) push('영문명', asString(b.영문명).trim());
    if ('수량' in b) push('수량', asNumber(b.수량));
    if ('단위' in b) push('단위', asString(b.단위).trim());
    if ('카테고리' in b) push('카테고리', asString(b.카테고리).trim());
    if ('보관방법' in b) push('보관방법', asString(b.보관방법).trim());
    if ('보관위치' in b) push('보관위치', asString(b.보관위치).trim());
    if ('소비기한_일' in b) push('소비기한_일', asNumber(b.소비기한_일));
    if ('알레르기' in b) pushJson('알레르기', b.알레르기);
    if ('아이선호도' in b) push('아이선호도', asNullableNumber(b.아이선호도));
    if ('주요영양소' in b) pushJson('주요영양소', b.주요영양소);
    if ('대표요리' in b) pushJson('대표요리', b.대표요리);
    if ('비고' in b) push('비고', asString(b.비고).trim());
    if (fields.length === 0) return res.status(400).json({ success: false, message: '수정할 내용이 없습니다.' });
    values.push(req.params.id);
    const { rows } = await pool.query(`UPDATE ingredients SET ${fields.join(', ')} WHERE "id" = $${i} RETURNING ${INGREDIENT_COLS}`, values);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '해당 식재료를 찾을 수 없습니다.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { console.error('PATCH /api/ingredients/:id:', err.message); res.status(500).json({ success: false, message: '식재료를 수정하지 못했습니다.' }); }
});

app.delete('/api/ingredients/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM ingredients WHERE "id" = $1 RETURNING "id"', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '해당 식재료를 찾을 수 없습니다.' });
    res.json({ success: true, data: { id: rows[0].id } });
  } catch (err) { console.error('DELETE /api/ingredients/:id:', err.message); res.status(500).json({ success: false, message: '식재료를 삭제하지 못했습니다.' }); }
});

// ============================================================
// 🤖 OpenAI 공통 호출 (JSON 모드)
// ============================================================
async function callOpenAIJSON(messages, { maxTokens = 2000, temperature = 0.7 } = {}) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw httpError(500, 'OPENAI_API_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요.');
  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, response_format: { type: 'json_object' }, temperature, max_tokens: maxTokens, messages }),
    });
  } catch (e) { throw httpError(502, `OpenAI 서버에 연결하지 못했습니다: ${e.message}`); }
  if (!resp.ok) {
    let detail = ''; try { const j = await resp.json(); detail = (j && j.error && j.error.message) || ''; } catch (_e) {}
    throw httpError(502, `AI 생성 실패 (OpenAI ${resp.status})${detail ? ': ' + detail : ''}`);
  }
  let data; try { data = await resp.json(); } catch (_e) { throw httpError(502, 'OpenAI 응답을 읽지 못했습니다.'); }
  const content = (data && data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : '';
  let parsed; try { parsed = JSON.parse(content || '{}'); } catch (_e) { throw httpError(502, 'AI 응답(JSON)을 해석하지 못했습니다. 다시 시도해 주세요.'); }
  return { parsed, model };
}

// 식재료 한 줄 표기
function ingredientLine(it) {
  const al = asArray(it.알레르기); const alStr = al.length ? ` · 알레르기:${al.join('/')}` : '';
  const pref = it.아이선호도 == null ? '' : ` · 아이선호도 ${it.아이선호도}/5`;
  return `- [${it.id}] ${it.이름} ${it.수량}${it.단위} · ${it.카테고리} · 소비기한 ${it.소비기한_일}일${alStr}${pref}`;
}
// 카테고리/이름 정렬(다양성용) vs 임박순 정렬
function orderForVariety(list) { return [...list].sort((a, b) => asString(a.카테고리).localeCompare(asString(b.카테고리), 'ko') || asString(a.이름).localeCompare(asString(b.이름), 'ko')); }
function orderByExpiry(list) { return [...list].sort((a, b) => asNumber(a.소비기한_일) - asNumber(b.소비기한_일)); }

const FAMILY_SYSTEM = [
  '당신은 3~7세 아이 2명을 포함한 4인 가족(어른 2 · 아이 2)을 위한 한국 가정식 요리 전문가입니다.',
  '규칙:',
  '1) 제공된 "보유 식재료"를 위주로 만들 수 있는 현실적인 요리를 제안합니다. 소금·물·기름 등 기본 양념은 추가 가능하나 큰 추가 구매는 피합니다.',
  '2) 아이가 함께 먹으므로 기본은 맵지 않게(순함). 어른용 매운맛은 따로 조절하도록 팁에 적습니다.',
  '3) 단백질·채소·곡물(주식)·양념 등 여러 카테고리의 재료를 골고루 활용하고, 한두 가지 재료에만 치우치지 않습니다.',
  '4) 사용 재료의 알레르기 유발 요소(난류·우유·대두·밀·갑각류·돼지고기·닭고기·쇠고기·참깨 등 한국 표시 기준)를 빠짐없이 표기합니다.',
  '5) 사용자가 "꼭 반영할 요청"을 주면 그 요청을 최우선으로 반영합니다.',
  '6) 모든 텍스트는 자연스러운 한국어. 지정된 JSON 객체 하나만 출력합니다(코드블록·설명 문장 금지).',
].join('\n');

// ============================================================
// 🍳 단일 AI 레시피 — 생성(미리보기) / 저장 / 목록 / 삭제
// ============================================================
const AI_RECIPE_COLS = '"id","제목","소요시간","인분","맵기","아이적합도","알레르기","재료","만드는법","아이팁","영양포인트","사용재료","요청옵션","ai_model","created_at"';
const RECIPE_SCHEMA = `{
  "제목": "음식 이모지로 시작하는 한글 제목",
  "소요시간": "예: 약 25분",
  "인분": "예: 4인분 (어른 2 + 아이 2)",
  "맵기": "순함 / 보통 / 매움 중 하나",
  "아이적합도": 1~5 정수,
  "알레르기": ["사용 재료 기준 알레르기 항목"],
  "재료": ["재료명 분량", "..."],
  "만드는법": ["1단계", "2단계", "..."],
  "아이팁": "아이가 잘 먹게 하는 팁",
  "영양포인트": "영양 포인트",
  "사용재료": ["보유 식재료 [id] 중 실제 사용한 id"]
}`;

async function generateRecipePreview(selected, opts, recentTitles) {
  const ordered = opts.임박우선 ? orderByExpiry(selected) : orderForVariety(selected);
  const lines = ordered.map(ingredientLine).join('\n');
  const parts = [];
  if (opts.추가요청) parts.push(`[⭐ 사용자가 꼭 반영해 달라는 요청 — 최우선 반영]\n${opts.추가요청}`);
  const wishes = [];
  if (opts.끼니) wishes.push(`끼니/종류: ${opts.끼니}`);
  if (opts.임박우선) wishes.push('소비기한이 임박한(숫자가 작은) 재료를 최대한 우선 소진할 것');
  else wishes.push('소비기한은 참고용일 뿐, 임박 여부와 무관하게 맛있고 균형 잡힌 한 끼를 우선할 것');
  wishes.push('여러 카테고리(단백질·채소·곡물·양념 등)의 재료를 골고루 활용하고 한두 가지에 치우치지 말 것');
  if (recentTitles && recentTitles.length) wishes.push(`최근 만든 레시피와 겹치지 않는 새로운 요리를 제안할 것 (최근: ${recentTitles.join(', ')})`);
  parts.push(`[조건]\n- ${wishes.join('\n- ')}`);
  parts.push(`[우리집 보유 식재료]\n${lines}`);
  parts.push(`위 재료로 우리 가족용 레시피 1개를 아래 JSON 형식으로만 출력하세요. "사용재료"에는 위 목록의 대괄호 안 id만 넣으세요.\n\n${RECIPE_SCHEMA}`);
  const { parsed, model } = await callOpenAIJSON(
    [{ role: 'system', content: FAMILY_SYSTEM }, { role: 'user', content: parts.join('\n\n') }],
    { maxTokens: 2000, temperature: 0.85 }
  );
  const validSet = new Set(selected.map((it) => it.id));
  return {
    제목: asString(parsed.제목).trim() || '🍽️ AI 추천 레시피',
    소요시간: asString(parsed.소요시간).trim(),
    인분: asString(parsed.인분).trim() || '4인분 (어른 2 + 아이 2)',
    맵기: asString(parsed.맵기).trim() || '순함',
    아이적합도: clampInt(parsed.아이적합도, 1, 5),
    알레르기: asArray(parsed.알레르기).map(asString).filter(Boolean),
    재료: asArray(parsed.재료).map(asString).filter(Boolean),
    만드는법: asArray(parsed.만드는법).map(asString).filter(Boolean),
    아이팁: asString(parsed.아이팁).trim(),
    영양포인트: asString(parsed.영양포인트).trim(),
    사용재료: asArray(parsed.사용재료).map(asString).filter((id) => validSet.has(id)),
    ai_model: model,
  };
}

// 생성(미리보기) — 저장하지 않는다.
app.post('/api/recipes/generate', async (req, res) => {
  try {
    const b = req.body || {};
    const wantIds = asArray(b.재료ids).map(asString).filter(Boolean);
    const opts = { 끼니: asString(b.끼니).trim(), 추가요청: asString(b.추가요청).trim(), 임박우선: !!b.임박우선 };
    const { rows: allIng } = await pool.query(`SELECT ${INGREDIENT_COLS} FROM ingredients ORDER BY "id" ASC`);
    if (allIng.length === 0) return res.status(400).json({ success: false, message: '냉장고에 식재료가 없습니다. "냉장고 재료" 탭에서 먼저 등록해 주세요.' });
    let selected = wantIds.length ? allIng.filter((it) => wantIds.includes(it.id)) : allIng;
    if (selected.length === 0) selected = allIng;
    const { rows: recent } = await pool.query('SELECT "제목" FROM ai_recipes ORDER BY "created_at" DESC LIMIT 6');
    const preview = await generateRecipePreview(selected, opts, recent.map((r) => r.제목));
    preview.요청옵션 = { 재료ids: selected.map((it) => it.id), ...opts };
    res.json({ success: true, data: preview }); // id 없음 — 아직 미저장
  } catch (err) {
    const status = err.status || 500; console.error('POST /api/recipes/generate:', err.message);
    res.status(status).json({ success: false, message: err.publicMessage || 'AI 레시피 생성에 실패했습니다.' });
  }
});

// 저장 — 사용자가 미리보기를 승인했을 때.
app.post('/api/recipes', async (req, res) => {
  try {
    const b = req.body || {};
    const 제목 = asString(b.제목).trim();
    if (!제목) return res.status(400).json({ success: false, message: '저장할 레시피 제목이 없습니다.' });
    const id = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const { rows } = await pool.query(
      `INSERT INTO ai_recipes ("id","제목","소요시간","인분","맵기","아이적합도","알레르기","재료","만드는법","아이팁","영양포인트","사용재료","요청옵션","ai_model")
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb,$14) RETURNING ${AI_RECIPE_COLS}`,
      [id, 제목, asString(b.소요시간).trim(), asString(b.인분).trim(), asString(b.맵기).trim(), clampInt(b.아이적합도, 1, 5),
       JSON.stringify(asArray(b.알레르기)), JSON.stringify(asArray(b.재료)), JSON.stringify(asArray(b.만드는법)),
       asString(b.아이팁).trim(), asString(b.영양포인트).trim(), JSON.stringify(asArray(b.사용재료)),
       JSON.stringify(b.요청옵션 && typeof b.요청옵션 === 'object' ? b.요청옵션 : {}), asString(b.ai_model).trim()]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { console.error('POST /api/recipes:', err.message); res.status(500).json({ success: false, message: '레시피를 저장하지 못했습니다.' }); }
});

app.get('/api/recipes', async (_req, res) => {
  try { const { rows } = await pool.query(`SELECT ${AI_RECIPE_COLS} FROM ai_recipes ORDER BY "created_at" DESC, "id" DESC`); res.json({ success: true, data: rows }); }
  catch (err) { console.error('GET /api/recipes:', err.message); res.status(500).json({ success: false, message: '레시피를 불러오지 못했습니다.' }); }
});

app.delete('/api/recipes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM ai_recipes WHERE "id" = $1 RETURNING "id"', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '해당 레시피를 찾을 수 없습니다.' });
    res.json({ success: true, data: { id: rows[0].id } });
  } catch (err) { console.error('DELETE /api/recipes/:id:', err.message); res.status(500).json({ success: false, message: '레시피를 삭제하지 못했습니다.' }); }
});

// ============================================================
// 🗓️ 주간·월간 식단 — 생성(미리보기) / 저장 / 목록 / 삭제
// ============================================================
const MEALPLAN_COLS = '"id","제목","기간","일수","계획","장보기목록","비고","요청옵션","ai_model","created_at"';

async function generateMealPlanPreview(selected, opts) {
  const 일수 = opts.기간 === '월간' ? 28 : 7;
  const ordered = opts.임박우선 ? orderByExpiry(selected) : orderForVariety(selected);
  const lines = ordered.map(ingredientLine).join('\n');
  const schema = `{
  "제목": "예: 우리집 ${opts.기간} 저녁 식단",
  "계획": [
    { "일차": 1, "끼니": "저녁", "제목": "🍗 메뉴 이름", "설명": "한 줄 설명", "사용재료": ["chicken","onion"] }
    // 1일차부터 ${일수}일차까지, 하루 1끼(저녁) 기준으로 총 ${일수}개
  ],
  "장보기목록": [
    { "재료": "닭고기", "필요량": "약 1.5kg", "사유": "기간 중 3회 사용, 보유 500g로 부족" }
  ],
  "비고": "식단 전체에 대한 짧은 메모(영양 균형/아이 고려 등)"
}`;
  const parts = [];
  if (opts.추가요청) parts.push(`[⭐ 사용자가 꼭 반영해 달라는 요청 — 최우선 반영]\n${opts.추가요청}`);
  const wishes = [
    `${일수}일치(${opts.기간}) 저녁 식단을 하루 1끼 기준으로 구성할 것 (계획 배열 길이 = ${일수})`,
    '날마다 메뉴가 겹치지 않게 다양하게, 단백질·채소·곡물을 골고루 배분할 것',
    '아이(3~7세)가 함께 먹으므로 기본은 순하게',
  ];
  if (opts.임박우선) wishes.push('소비기한이 임박한 재료를 식단 앞쪽에 우선 배치해 소진할 것');
  wishes.push('각 재료의 "보유 수량(수량+단위)"을 고려해, 이 식단을 모두 만들면 부족해질(=구매가 필요한) 재료를 "장보기목록"에 필요량과 사유와 함께 정리할 것');
  parts.push(`[조건]\n- ${wishes.join('\n- ')}`);
  parts.push(`[우리집 보유 식재료 — 수량 포함]\n${lines}`);
  parts.push(`아래 JSON 형식으로만 출력하세요. "사용재료"에는 위 목록의 대괄호 안 id만 넣으세요.\n\n${schema}`);
  const { parsed, model } = await callOpenAIJSON(
    [{ role: 'system', content: FAMILY_SYSTEM }, { role: 'user', content: parts.join('\n\n') }],
    { maxTokens: 일수 >= 28 ? 4096 : 2600, temperature: 0.8 }
  );
  const validSet = new Set(selected.map((it) => it.id));
  const 계획 = asArray(parsed.계획).map((d, idx) => ({
    일차: clampInt(d.일차 != null ? d.일차 : idx + 1, 1, 400),
    끼니: asString(d.끼니).trim() || '저녁',
    제목: asString(d.제목).trim() || '추천 메뉴',
    설명: asString(d.설명).trim(),
    사용재료: asArray(d.사용재료).map(asString).filter((id) => validSet.has(id)),
  })).slice(0, 일수);
  const 장보기목록 = asArray(parsed.장보기목록).map((s) => ({
    재료: asString(s.재료).trim(), 필요량: asString(s.필요량).trim(), 사유: asString(s.사유).trim(),
  })).filter((s) => s.재료);
  return {
    제목: asString(parsed.제목).trim() || `우리집 ${opts.기간} 저녁 식단`,
    기간: opts.기간, 일수, 계획, 장보기목록, 비고: asString(parsed.비고).trim(), ai_model: model,
  };
}

app.post('/api/mealplans/generate', async (req, res) => {
  try {
    const b = req.body || {};
    const 기간 = asString(b.기간).trim() === '월간' ? '월간' : '주간';
    const wantIds = asArray(b.재료ids).map(asString).filter(Boolean);
    const opts = { 기간, 추가요청: asString(b.추가요청).trim(), 임박우선: !!b.임박우선 };
    const { rows: allIng } = await pool.query(`SELECT ${INGREDIENT_COLS} FROM ingredients ORDER BY "id" ASC`);
    if (allIng.length === 0) return res.status(400).json({ success: false, message: '냉장고에 식재료가 없습니다. "냉장고 재료" 탭에서 먼저 등록해 주세요.' });
    let selected = wantIds.length ? allIng.filter((it) => wantIds.includes(it.id)) : allIng;
    if (selected.length === 0) selected = allIng;
    const preview = await generateMealPlanPreview(selected, opts);
    preview.요청옵션 = { 재료ids: selected.map((it) => it.id), 기간, 추가요청: opts.추가요청, 임박우선: opts.임박우선 };
    res.json({ success: true, data: preview });
  } catch (err) {
    const status = err.status || 500; console.error('POST /api/mealplans/generate:', err.message);
    res.status(status).json({ success: false, message: err.publicMessage || 'AI 식단 생성에 실패했습니다.' });
  }
});

app.post('/api/mealplans', async (req, res) => {
  try {
    const b = req.body || {};
    const 제목 = asString(b.제목).trim();
    if (!제목) return res.status(400).json({ success: false, message: '저장할 식단 제목이 없습니다.' });
    const id = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const { rows } = await pool.query(
      `INSERT INTO meal_plans ("id","제목","기간","일수","계획","장보기목록","비고","요청옵션","ai_model")
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9) RETURNING ${MEALPLAN_COLS}`,
      [id, 제목, asString(b.기간).trim() || '주간', asNumber(b.일수, 7), JSON.stringify(asArray(b.계획)),
       JSON.stringify(asArray(b.장보기목록)), asString(b.비고).trim(),
       JSON.stringify(b.요청옵션 && typeof b.요청옵션 === 'object' ? b.요청옵션 : {}), asString(b.ai_model).trim()]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { console.error('POST /api/mealplans:', err.message); res.status(500).json({ success: false, message: '식단을 저장하지 못했습니다.' }); }
});

app.get('/api/mealplans', async (_req, res) => {
  try { const { rows } = await pool.query(`SELECT ${MEALPLAN_COLS} FROM meal_plans ORDER BY "created_at" DESC, "id" DESC`); res.json({ success: true, data: rows }); }
  catch (err) { console.error('GET /api/mealplans:', err.message); res.status(500).json({ success: false, message: '식단을 불러오지 못했습니다.' }); }
});

app.delete('/api/mealplans/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM meal_plans WHERE "id" = $1 RETURNING "id"', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '해당 식단을 찾을 수 없습니다.' });
    res.json({ success: true, data: { id: rows[0].id } });
  } catch (err) { console.error('DELETE /api/mealplans/:id:', err.message); res.status(500).json({ success: false, message: '식단을 삭제하지 못했습니다.' }); }
});

// SPA fallback
app.get(/^\/(?!api\/).*/, (_req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

if (require.main === module) {
  app.listen(PORT, () => { console.log(`AI 레시피/식단 서버 실행 중: http://localhost:${PORT}`); });
}
module.exports = app;
