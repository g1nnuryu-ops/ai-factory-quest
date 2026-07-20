// ============================================================
// 우리집 냉장고 식재료 & 레시피 관리 — API server
// Express + PostgreSQL (Supabase). 단일 프론트엔드 index.html(인라인 React) + 이 server.js.
// ============================================================

const path = require('path');

// Load .env from next to this file, regardless of the current working
// directory (so `node server.js` works even when launched from elsewhere).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// PostgreSQL pool (Supabase transaction pooler requires SSL)
// .trim() guards against trailing-newline quirks in env vars.
// ------------------------------------------------------------
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ============================================================
// 🌱 Seed data (식재료 24종 · 레시피 3종)
//   index.html 의 SEED_INGREDIENTS / SEED_RECIPES 를 그대로 옮겨온 것.
//   DB가 비어 있을 때 1회 주입되어 데모를 바로 사용할 수 있게 한다.
// ============================================================
const SEED_INGREDIENTS = [
  { id:'egg', 이름:'계란', 영문명:'Egg', 수량:10, 단위:'개', 카테고리:'단백질·달걀', 보관방법:'냉장', 보관위치:'냉장실 안쪽 선반(도어 권장 안 함)', 소비기한_일:18, 알레르기:['난류'], 아이선호도:5, 주요영양소:['단백질','비타민D','콜린','철분'], 대표요리:['계란말이','계란찜','계란국','스크램블에그'], 비고:'유아 단백질 공급의 핵심 재료로 거의 매일 사용. 뾰족한 부분이 아래로 가게 보관.' },
  { id:'milk', 이름:'우유', 영문명:'Milk', 수량:2, 단위:'팩(900mL)', 카테고리:'유제품', 보관방법:'냉장', 보관위치:'냉장실 안쪽(도어 권장 안 함)', 소비기한_일:3, 알레르기:['우유'], 아이선호도:5, 주요영양소:['칼슘','단백질','비타민D'], 대표요리:['우유','시리얼','베샤멜소스','스무디'], 비고:'개봉 후 빨리 소비. 도어보다 온도 변화가 적은 안쪽 선반 권장.' },
  { id:'tofu', 이름:'두부', 영문명:'Tofu', 수량:1, 단위:'모(300g)', 카테고리:'콩가공품', 보관방법:'냉장', 보관위치:'냉장실', 소비기한_일:7, 알레르기:['대두'], 아이선호도:4, 주요영양소:['식물성단백질','칼슘','이소플라본'], 대표요리:['두부조림','두부부침','된장찌개','두부스테이크'], 비고:'부드러워 유아식에 적합. 개봉 후 남으면 물에 잠기게 담아 매일 물을 갈아 보관.' },
  { id:'kimchi', 이름:'배추김치', 영문명:'Kimchi', 수량:1, 단위:'통(1kg)', 카테고리:'발효식품·채소', 보관방법:'냉장', 보관위치:'김치냉장고 또는 냉장실', 소비기한_일:90, 알레르기:['새우'], 아이선호도:2, 주요영양소:['유산균','식이섬유','비타민C'], 대표요리:['김치찌개','김치볶음밥','김치전'], 비고:'아이용은 물에 한 번 헹궈 매운맛·짠맛을 덜어 사용.' },
  { id:'carrot', 이름:'당근', 영문명:'Carrot', 수량:3, 단위:'개', 카테고리:'채소(뿌리채소)', 보관방법:'냉장', 보관위치:'채소칸(신문지·키친타월에 싸서)', 소비기한_일:25, 알레르기:[], 아이선호도:3, 주요영양소:['베타카로틴','비타민A','식이섬유'], 대표요리:['당근볶음','카레','볶음밥','당근라페'], 비고:'잘게 다져 볶음밥·계란요리에 섞으면 거부감 적음.' },
  { id:'spinach', 이름:'시금치', 영문명:'Spinach', 수량:1, 단위:'단', 카테고리:'채소(엽채류)', 보관방법:'냉장', 보관위치:'채소칸(세워서, 젖은 키친타월에 싸서)', 소비기한_일:3, 알레르기:[], 아이선호도:2, 주요영양소:['철분','엽산','비타민K','베타카로틴'], 대표요리:['시금치나물','된장국','시금치무침','계란말이'], 비고:'금방 무르므로 빨리 사용. 살짝 데쳐 잘게 썰면 아이도 잘 먹음.' },
  { id:'green-onion', 이름:'대파', 영문명:'Green Onion', 수량:1, 단위:'단', 카테고리:'채소(향신채소)', 보관방법:'냉장', 보관위치:'채소칸(키친타월에 싸서) 또는 손질 후 냉동', 소비기한_일:14, 알레르기:[], 아이선호도:2, 주요영양소:['알리신','비타민C','식이섬유'], 대표요리:['파국','계란말이','볶음 가니시','파기름'], 비고:'송송 썰어 냉동하면 오래 사용 가능.' },
  { id:'pork', 이름:'돼지고기(앞다리살)', 영문명:'Pork (Front Leg)', 수량:500, 단위:'g', 카테고리:'육류', 보관방법:'냉장(단기)·냉동(장기)', 보관위치:'냉장 육류칸 또는 냉동실(소분)', 소비기한_일:3, 알레르기:['돼지고기'], 아이선호도:4, 주요영양소:['단백질','비타민B1','철분'], 대표요리:['제육볶음(순한맛)','돼지고기조림','카레','돼지고기미역국'], 비고:'1회분씩 소분해 냉동하면 30일까지 보관 가능.' },
  { id:'chicken', 이름:'닭고기(닭다리살)', 영문명:'Chicken (Thigh)', 수량:500, 단위:'g', 카테고리:'육류', 보관방법:'냉장(단기)·냉동(장기)', 보관위치:'냉장 육류칸 또는 냉동실(소분)', 소비기한_일:2, 알레르기:['닭고기'], 아이선호도:5, 주요영양소:['단백질','비타민B6','나이아신'], 대표요리:['닭볶음탕(순한맛)','닭갈비','데리야끼치킨','닭죽'], 비고:'아이들이 매우 선호. 우유에 재우면 잡내가 줄고 부드러워짐.' },
  { id:'cheese', 이름:'슬라이스 치즈(아기치즈)', 영문명:'Sliced Cheese', 수량:10, 단위:'장', 카테고리:'유제품', 보관방법:'냉장', 보관위치:'냉장실 도어 또는 선반', 소비기한_일:30, 알레르기:['우유'], 아이선호도:5, 주요영양소:['칼슘','단백질'], 대표요리:['치즈계란말이','치즈김밥','치즈토스트','치즈볼'], 비고:'유아용은 나트륨이 낮은 아기치즈 선택.' },
  { id:'yogurt', 이름:'플레인 요거트', 영문명:'Plain Yogurt', 수량:4, 단위:'개', 카테고리:'유제품', 보관방법:'냉장', 보관위치:'냉장실', 소비기한_일:11, 알레르기:['우유'], 아이선호도:5, 주요영양소:['유산균','칼슘','단백질'], 대표요리:['과일요거트','요거트볼','요거트드레싱','스무디'], 비고:'무가당 플레인에 제철 과일을 곁들이면 건강 간식.' },
  { id:'apple', 이름:'사과', 영문명:'Apple', 수량:5, 단위:'개', 카테고리:'과일', 보관방법:'냉장', 보관위치:'채소칸(개별 포장해 다른 채소와 분리)', 소비기한_일:21, 알레르기:[], 아이선호도:5, 주요영양소:['식이섬유','비타민C','펙틴'], 대표요리:['생과일','사과주스','사과조림','사과샐러드'], 비고:'에틸렌가스를 내뿜으니 개별 포장해 분리 보관. 아이 간식 1순위.' },
  { id:'strawberry', 이름:'딸기', 영문명:'Strawberry', 수량:1, 단위:'팩(500g)', 카테고리:'과일', 보관방법:'냉장', 보관위치:'냉장실(씻지 않은 채로)', 소비기한_일:2, 알레르기:[], 아이선호도:5, 주요영양소:['비타민C','안토시아닌','엽산'], 대표요리:['생과일','딸기우유','딸기잼','스무디'], 비고:'물러지기 쉬워 먹기 직전에 세척. 아이 간식·디저트로 인기.' },
  { id:'king-oyster-mushroom', 이름:'새송이버섯', 영문명:'King Oyster Mushroom', 수량:2, 단위:'개', 카테고리:'버섯', 보관방법:'냉장', 보관위치:'채소칸(키친타월에 싸서)', 소비기한_일:10, 알레르기:[], 아이선호도:3, 주요영양소:['식이섬유','비타민D','칼륨'], 대표요리:['버섯볶음','잡채','버섯전','된장찌개'], 비고:'쫄깃한 식감으로 고기 대체 가능. 물기에 약하니 씻지 말고 닦아서 보관.' },
  { id:'onion', 이름:'양파', 영문명:'Onion', 수량:5, 단위:'개', 카테고리:'채소(양념채소)', 보관방법:'실온', 보관위치:'서늘하고 통풍되는 곳(망에 담아)', 소비기한_일:30, 알레르기:[], 아이선호도:2, 주요영양소:['퀘르세틴','알리신','식이섬유'], 대표요리:['거의 모든 볶음·국·찌개','카레','양파볶음'], 비고:'충분히 볶으면 단맛이 강해져 아이도 잘 먹음. 감자와 분리 보관.' },
  { id:'garlic', 이름:'마늘', 영문명:'Garlic', 수량:1, 단위:'통(다진마늘 200g)', 카테고리:'채소(향신채소)', 보관방법:'실온·냉장/냉동(다진마늘)', 보관위치:'통마늘은 서늘한 곳, 다진마늘은 소분 냉동', 소비기한_일:30, 알레르기:[], 아이선호도:2, 주요영양소:['알리신','셀레늄','비타민B6'], 대표요리:['거의 모든 한식 양념','마늘볶음','갈릭버터'], 비고:'유아식엔 향이 강하니 소량만 사용.' },
  { id:'potato', 이름:'감자', 영문명:'Potato', 수량:5, 단위:'개', 카테고리:'채소(서류)', 보관방법:'실온', 보관위치:'어둡고 서늘하며 통풍되는 곳', 소비기한_일:30, 알레르기:[], 아이선호도:4, 주요영양소:['탄수화물','비타민C','칼륨'], 대표요리:['감자조림','감자국','감자전','으깬감자'], 비고:'빛을 받으면 솔라닌 생성. 싹·녹색 부분은 제거. 양파와 분리.' },
  { id:'rice', 이름:'쌀', 영문명:'Rice', 수량:10, 단위:'kg', 카테고리:'곡류·주식', 보관방법:'실온', 보관위치:'밀폐 쌀통(서늘하고 건조한 곳)', 소비기한_일:180, 알레르기:[], 아이선호도:4, 주요영양소:['탄수화물','단백질'], 대표요리:['밥','죽','볶음밥','주먹밥'], 비고:'가족 주식. 무르게 지은 진밥·죽으로 유아식 활용.' },
  { id:'soy-sauce', 이름:'간장', 영문명:'Soy Sauce', 수량:1, 단위:'병(500mL)', 카테고리:'양념(장류)', 보관방법:'실온(개봉 전)·냉장(개봉 후)', 보관위치:'서늘한 곳, 개봉 후 냉장', 소비기한_일:365, 알레르기:['대두','밀'], 아이선호도:null, 주요영양소:['나트륨','아미노산'], 대표요리:['조림','무침','볶음','국 간'], 비고:'발효 장류로 대두·밀 알레르기 주의. 유아식은 소량만.' },
  { id:'sesame-oil', 이름:'참기름', 영문명:'Sesame Oil', 수량:1, 단위:'병(320mL)', 카테고리:'유지·양념', 보관방법:'실온', 보관위치:'빛이 들지 않는 서늘한 곳', 소비기한_일:180, 알레르기:['참깨'], 아이선호도:null, 주요영양소:['지방','비타민E'], 대표요리:['나물무침','비빔밥','김밥','마무리 향내기'], 비고:'직사광선·고온에 약해 산패되기 쉬움. 향이 강해 소량으로 풍미를 냄.' },
  { id:'sugar', 이름:'설탕', 영문명:'Sugar', 수량:1, 단위:'봉(1kg)', 카테고리:'양념(조미료)', 보관방법:'실온', 보관위치:'건조한 곳(습기 차단)', 소비기한_일:730, 알레르기:[], 아이선호도:null, 주요영양소:['탄수화물'], 대표요리:['단맛 조절 전반','조림','베이킹'], 비고:'굳지 않게 밀폐 보관. 유아식은 최소량만.' },
  { id:'cooking-oil', 이름:'식용유', 영문명:'Cooking Oil', 수량:1, 단위:'병(900mL)', 카테고리:'유지·양념', 보관방법:'실온', 보관위치:'직사광선 피한 서늘한 곳', 소비기한_일:240, 알레르기:[], 아이선호도:null, 주요영양소:['지방'], 대표요리:['볶음','부침','튀김'], 비고:'개봉 후 산패되지 않게 뚜껑을 꼭 닫아 서늘하게 보관.' },
  { id:'seasoned-laver', 이름:'조미김', 영문명:'Seasoned Laver', 수량:1, 단위:'봉(8봉입)', 카테고리:'해조·반찬', 보관방법:'실온', 보관위치:'건조한 곳(밀봉)', 소비기한_일:120, 알레르기:['대두'], 아이선호도:5, 주요영양소:['요오드','식이섬유','미네랄'], 대표요리:['밥 반찬','김밥','주먹밥','김자반'], 비고:'아이 밥반찬 단골. 개봉 후 밀봉 보관.' },
  { id:'banana', 이름:'바나나', 영문명:'Banana', 수량:1, 단위:'송이(5~6개)', 카테고리:'과일', 보관방법:'실온', 보관위치:'통풍되는 곳에 걸어서(꼭지는 랩으로)', 소비기한_일:4, 알레르기:[], 아이선호도:5, 주요영양소:['칼륨','식이섬유','비타민B6'], 대표요리:['생과일','바나나우유','바나나팬케이크','스무디'], 비고:'냉장 시 껍질이 검게 변하므로 실온 보관. 아이 아침·간식으로 인기.' },
];

const SEED_RECIPES = [
  {
    id:'chicken-teriyaki-donburi',
    제목:'🍗 닭다리살 간장 데리야끼 덮밥',
    소요시간:'약 25분', 인분:'4인분 (어른 2 + 아이 2)', 맵기:'순함 (안 매움)', 아이적합도:5,
    알레르기:['닭고기','대두','밀','난류'],
    재료:['닭고기(닭다리살) 500g','양파 1개','대파 흰 부분 조금','밥 4공기','계란 4개(프라이용)','조미김 약간','간장 4큰술','설탕 2큰술','물 4~5큰술','다진마늘 1작은술','식용유 1큰술','참기름 약간'],
    만드는법:[
      '닭다리살을 한입 크기로 썬다. (선택) 우유에 10분 재우면 잡내가 줄고 부드러워진다 — 이후 키친타월로 물기 제거.',
      '양파는 채썰고, 대파 흰 부분은 송송 썬다.',
      '소스 재료(간장 4·설탕 2·물 4~5·다진마늘 1작은술)를 미리 섞어 둔다.',
      '팬에 식용유를 두르고 중강불에서 닭을 껍질 쪽부터 노릇하게 구운 뒤 속까지 완전히 익힌다(핑크빛 없이).',
      '양파를 넣어 투명해질 때까지 볶다가 소스를 부어 중불에서 국물이 자작하고 윤기 날 때까지 3~5분 졸인다. 불을 끄고 참기름 한 방울.',
      '따로 계란프라이를 부친다.',
      '그릇에 밥 → 데리야끼 닭 → 계란프라이 → 대파·조미김을 올려 완성.'
    ],
    아이팁:'아이용은 닭을 가위로 잘게 자르고 소스는 조금만 끼얹어 나트륨·당을 줄인다. 당근채·애호박을 함께 볶아 채소 섭취를 늘릴 수 있다.',
    영양포인트:'닭다리살(단백질·B6) + 밥(탄수화물) + 양파(퀘르세틴) + 계란(단백질)으로 한 그릇 균형 한 끼. 매운 양념 없이도 아이가 잘 먹음.',
    사용재료:['chicken','onion','green-onion','rice','egg','seasoned-laver','soy-sauce','sugar','garlic','cooking-oil','sesame-oil'],
  },
  {
    id:'strawberry-yogurt-bowl',
    제목:'🍓 딸기 요거트볼',
    소요시간:'약 7분', 인분:'4인분 (어른 2 + 아이 2)', 맵기:'해당 없음 (무가열)', 아이적합도:5,
    알레르기:['우유'],
    재료:['플레인 요거트 4개(≈340~400g)','딸기 1/2팩(≈250g)','바나나 1개','사과 1/2개','(선택) 꿀 또는 시럽 1~2큰술'],
    만드는법:[
      '딸기는 먹기 직전 흐르는 물에 살짝 헹궈 꼭지를 떼고, 큰 건 2~4등분.',
      '바나나는 동그랗게 슬라이스, 사과는 껍질 벗겨 작은 큐브로.',
      '컵/볼에 플레인 요거트를 담고 그 위에 딸기·바나나·사과를 올린다.',
      '(선택) 꿀/시럽을 살짝 두르고 그래놀라를 뿌린다.',
      '과일을 색깔별로 층층이 담아 무지개 컵으로 내면 완성.'
    ],
    아이팁:'무가당 요거트가 시면 잘 익은 바나나를 으깨 섞어 자연 단맛을 낸다. ⚠️ 어린아이는 바나나 조각을 반드시 작게(질식 예방). 돌 이전엔 꿀 금지.',
    영양포인트:'요거트(유산균·칼슘·단백질) + 딸기(비타민C) + 바나나(칼륨)로 장 건강·면역·에너지를 한 번에. 무가당+과일 자연단맛으로 부담이 적음.',
    사용재료:['yogurt','strawberry','banana','apple'],
  },
  {
    id:'tofu-veggie-soybean-stew',
    제목:'🥘 순한 두부 채소 된장국',
    소요시간:'약 20분', 인분:'4인분 (어른 2 + 아이 2)', 맵기:'순함 (안 매움)', 아이적합도:4,
    알레르기:['대두'],
    재료:['두부 1/2모','감자 1개','애호박/당근 약간','양파 1/4개','대파 조금','된장 1큰술(아이용은 소량)','다진마늘 1/2작은술','물 4컵','참기름 약간'],
    만드는법:[
      '감자·당근은 작은 큐브로, 양파는 채썰고 두부는 깍둑 썬다.',
      '냄비에 물을 붓고 된장을 풀어 끓인다(아이용은 된장을 적게).',
      '감자·당근을 먼저 넣어 익히다가 양파·다진마늘을 넣는다.',
      '두부를 넣고 5분 더 끓인 뒤 대파를 넣고 불을 끈다.',
      '참기름 한 방울로 마무리. 아이 그릇엔 국물을 연하게 떠 담는다.'
    ],
    아이팁:'된장을 평소의 절반 이하로 풀어 짠맛을 줄인다. 두부와 감자가 부드러워 유아식에 좋고, 채소는 잘게 썰면 거부감이 적다.',
    영양포인트:'두부(식물성단백질·칼슘) + 감자(탄수화물) + 채소(식이섬유)로 속이 편한 한 끼. 발효 된장의 풍미로 아이도 부담 없이 먹는 국.',
    사용재료:['tofu','potato','carrot','onion','green-onion','garlic','sesame-oil'],
  },
];

// ------------------------------------------------------------
// 입력 정규화 헬퍼
// ------------------------------------------------------------
const asArray = (v) => (Array.isArray(v) ? v : []);
const asString = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
const asNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
// 아이선호도: 숫자거나 null. 빈문자열/undefined → null.
const asNullableNumber = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// 영문 슬러그 생성 (id 미제공 시 영문명/이름 기반)
const slugify = (s) =>
  asString(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ------------------------------------------------------------
// Lazy migration + seed: 테이블을 1회 생성하고 비어 있으면 seed 주입.
// dbInitialized 플래그로 매 요청/서버리스 cold start 마다 재실행되는 것을 막는다.
// ------------------------------------------------------------
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ingredients (
      "id"           TEXT PRIMARY KEY,
      "이름"          TEXT NOT NULL DEFAULT '',
      "영문명"        TEXT NOT NULL DEFAULT '',
      "수량"          NUMERIC NOT NULL DEFAULT 0,
      "단위"          TEXT NOT NULL DEFAULT '',
      "카테고리"       TEXT NOT NULL DEFAULT '',
      "보관방법"       TEXT NOT NULL DEFAULT '',
      "보관위치"       TEXT NOT NULL DEFAULT '',
      "소비기한_일"     INTEGER NOT NULL DEFAULT 0,
      "알레르기"       JSONB NOT NULL DEFAULT '[]',
      "아이선호도"      INTEGER,
      "주요영양소"      JSONB NOT NULL DEFAULT '[]',
      "대표요리"       JSONB NOT NULL DEFAULT '[]',
      "비고"          TEXT NOT NULL DEFAULT '',
      "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      "id"           TEXT PRIMARY KEY,
      "제목"          TEXT NOT NULL DEFAULT '',
      "소요시간"       TEXT NOT NULL DEFAULT '',
      "인분"          TEXT NOT NULL DEFAULT '',
      "맵기"          TEXT NOT NULL DEFAULT '',
      "아이적합도"      INTEGER NOT NULL DEFAULT 3,
      "알레르기"       JSONB NOT NULL DEFAULT '[]',
      "재료"          JSONB NOT NULL DEFAULT '[]',
      "만드는법"       JSONB NOT NULL DEFAULT '[]',
      "아이팁"         TEXT NOT NULL DEFAULT '',
      "영양포인트"      TEXT NOT NULL DEFAULT '',
      "사용재료"       JSONB NOT NULL DEFAULT '[]',
      "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // 식재료 seed (비어 있을 때만)
  const ing = await pool.query('SELECT count(*)::int AS n FROM ingredients');
  if (ing.rows[0].n === 0) {
    for (const it of SEED_INGREDIENTS) {
      await pool.query(
        `INSERT INTO ingredients
          ("id","이름","영문명","수량","단위","카테고리","보관방법","보관위치","소비기한_일","알레르기","아이선호도","주요영양소","대표요리","비고")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14)
         ON CONFLICT ("id") DO NOTHING`,
        [
          it.id, it.이름, it.영문명, asNumber(it.수량), it.단위, it.카테고리, it.보관방법, it.보관위치,
          asNumber(it.소비기한_일), JSON.stringify(asArray(it.알레르기)), asNullableNumber(it.아이선호도),
          JSON.stringify(asArray(it.주요영양소)), JSON.stringify(asArray(it.대표요리)), it.비고,
        ]
      );
    }
    console.log(`Seeded ${SEED_INGREDIENTS.length} ingredients.`);
  }

  // 레시피 seed (비어 있을 때만)
  const rec = await pool.query('SELECT count(*)::int AS n FROM recipes');
  if (rec.rows[0].n === 0) {
    for (const r of SEED_RECIPES) {
      await pool.query(
        `INSERT INTO recipes
          ("id","제목","소요시간","인분","맵기","아이적합도","알레르기","재료","만드는법","아이팁","영양포인트","사용재료")
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb)
         ON CONFLICT ("id") DO NOTHING`,
        [
          r.id, r.제목, r.소요시간, r.인분, r.맵기, asNumber(r.아이적합도, 3),
          JSON.stringify(asArray(r.알레르기)), JSON.stringify(asArray(r.재료)), JSON.stringify(asArray(r.만드는법)),
          r.아이팁, r.영양포인트, JSON.stringify(asArray(r.사용재료)),
        ]
      );
    }
    console.log(`Seeded ${SEED_RECIPES.length} recipes.`);
  }

  dbInitialized = true;
}

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Ensure tables exist (and seed runs) before any /api request is handled.
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
// 🧊 Ingredients API
// ============================================================
const INGREDIENT_COLS =
  '"id","이름","영문명","수량","단위","카테고리","보관방법","보관위치","소비기한_일","알레르기","아이선호도","주요영양소","대표요리","비고","created_at"';

// 식재료 전체 조회 — 소비기한 임박순(ASC), 동률이면 id 순.
app.get('/api/ingredients', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${INGREDIENT_COLS} FROM ingredients ORDER BY "소비기한_일" ASC, "id" ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/ingredients:', err.message);
    res.status(500).json({ success: false, message: '식재료를 불러오지 못했습니다.' });
  }
});

// 식재료 생성 — body 는 client id(slug) 포함 전체 객체.
app.post('/api/ingredients', async (req, res) => {
  try {
    const b = req.body || {};
    const 이름 = asString(b.이름).trim();
    if (!이름) {
      return res.status(400).json({ success: false, message: '식재료 이름을 입력해 주세요.' });
    }
    // id: 제공되면 사용, 없으면 영문명/이름으로 슬러그 생성.
    const id = asString(b.id).trim() || slugify(b.영문명) || slugify(이름);
    if (!id) {
      return res.status(400).json({ success: false, message: '식재료 ID(영문 슬러그)를 만들 수 없습니다. 영문명을 입력해 주세요.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO ingredients
        ("id","이름","영문명","수량","단위","카테고리","보관방법","보관위치","소비기한_일","알레르기","아이선호도","주요영양소","대표요리","비고")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14)
       RETURNING ${INGREDIENT_COLS}`,
      [
        id, 이름, asString(b.영문명).trim(), asNumber(b.수량), asString(b.단위).trim(),
        asString(b.카테고리).trim(), asString(b.보관방법).trim(), asString(b.보관위치).trim(),
        asNumber(b.소비기한_일), JSON.stringify(asArray(b.알레르기)), asNullableNumber(b.아이선호도),
        JSON.stringify(asArray(b.주요영양소)), JSON.stringify(asArray(b.대표요리)), asString(b.비고).trim(),
      ]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ success: false, message: '이미 같은 ID의 식재료가 있습니다. 다른 영문명을 사용해 주세요.' });
    }
    console.error('POST /api/ingredients:', err.message);
    res.status(500).json({ success: false, message: '식재료를 추가하지 못했습니다.' });
  }
});

// 식재료 부분 수정 — 전달된 필드만 동적 UPDATE.
app.patch('/api/ingredients/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const b = req.body || {};

    // 컬럼명 → 정규화 함수 매핑. body 에 키가 존재할 때만 SET 에 추가.
    const fields = [];
    const values = [];
    let i = 1;
    const push = (col, val) => { fields.push(`"${col}" = $${i++}`); values.push(val); };

    if ('이름' in b) {
      const v = asString(b.이름).trim();
      if (!v) return res.status(400).json({ success: false, message: '식재료 이름은 비울 수 없습니다.' });
      push('이름', v);
    }
    if ('영문명' in b) push('영문명', asString(b.영문명).trim());
    if ('수량' in b) push('수량', asNumber(b.수량));
    if ('단위' in b) push('단위', asString(b.단위).trim());
    if ('카테고리' in b) push('카테고리', asString(b.카테고리).trim());
    if ('보관방법' in b) push('보관방법', asString(b.보관방법).trim());
    if ('보관위치' in b) push('보관위치', asString(b.보관위치).trim());
    if ('소비기한_일' in b) push('소비기한_일', asNumber(b.소비기한_일));
    if ('알레르기' in b) { fields.push(`"알레르기" = $${i++}::jsonb`); values.push(JSON.stringify(asArray(b.알레르기))); }
    if ('아이선호도' in b) push('아이선호도', asNullableNumber(b.아이선호도));
    if ('주요영양소' in b) { fields.push(`"주요영양소" = $${i++}::jsonb`); values.push(JSON.stringify(asArray(b.주요영양소))); }
    if ('대표요리' in b) { fields.push(`"대표요리" = $${i++}::jsonb`); values.push(JSON.stringify(asArray(b.대표요리))); }
    if ('비고' in b) push('비고', asString(b.비고).trim());

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: '수정할 내용이 없습니다.' });
    }

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE ingredients SET ${fields.join(', ')} WHERE "id" = $${i} RETURNING ${INGREDIENT_COLS}`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 식재료를 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('PATCH /api/ingredients/:id:', err.message);
    res.status(500).json({ success: false, message: '식재료를 수정하지 못했습니다.' });
  }
});

// 식재료 삭제.
app.delete('/api/ingredients/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM ingredients WHERE "id" = $1 RETURNING "id"',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 식재료를 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: { id: rows[0].id } });
  } catch (err) {
    console.error('DELETE /api/ingredients/:id:', err.message);
    res.status(500).json({ success: false, message: '식재료를 삭제하지 못했습니다.' });
  }
});

// ============================================================
// 🍳 Recipes API
// ============================================================
const RECIPE_COLS =
  '"id","제목","소요시간","인분","맵기","아이적합도","알레르기","재료","만드는법","아이팁","영양포인트","사용재료","created_at"';

// 레시피 전체 조회 — 최신 등록순.
app.get('/api/recipes', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${RECIPE_COLS} FROM recipes ORDER BY "created_at" DESC, "id" DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/recipes:', err.message);
    res.status(500).json({ success: false, message: '레시피를 불러오지 못했습니다.' });
  }
});

// 레시피 생성 — body 는 client id 포함 전체 객체.
app.post('/api/recipes', async (req, res) => {
  try {
    const b = req.body || {};
    const 제목 = asString(b.제목).trim();
    if (!제목) {
      return res.status(400).json({ success: false, message: '레시피 제목을 입력해 주세요.' });
    }
    const id = asString(b.id).trim() || `recipe_${Date.now().toString(36)}`;

    const { rows } = await pool.query(
      `INSERT INTO recipes
        ("id","제목","소요시간","인분","맵기","아이적합도","알레르기","재료","만드는법","아이팁","영양포인트","사용재료")
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb)
       RETURNING ${RECIPE_COLS}`,
      [
        id, 제목, asString(b.소요시간).trim(), asString(b.인분).trim(), asString(b.맵기).trim(),
        asNumber(b.아이적합도, 3), JSON.stringify(asArray(b.알레르기)), JSON.stringify(asArray(b.재료)),
        JSON.stringify(asArray(b.만드는법)), asString(b.아이팁).trim(), asString(b.영양포인트).trim(),
        JSON.stringify(asArray(b.사용재료)),
      ]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ success: false, message: '이미 같은 ID의 레시피가 있습니다.' });
    }
    console.error('POST /api/recipes:', err.message);
    res.status(500).json({ success: false, message: '레시피를 추가하지 못했습니다.' });
  }
});

// 레시피 부분 수정 — 전달된 필드만 동적 UPDATE.
app.patch('/api/recipes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const b = req.body || {};

    const fields = [];
    const values = [];
    let i = 1;
    const push = (col, val) => { fields.push(`"${col}" = $${i++}`); values.push(val); };
    const pushJson = (col, val) => { fields.push(`"${col}" = $${i++}::jsonb`); values.push(JSON.stringify(asArray(val))); };

    if ('제목' in b) {
      const v = asString(b.제목).trim();
      if (!v) return res.status(400).json({ success: false, message: '레시피 제목은 비울 수 없습니다.' });
      push('제목', v);
    }
    if ('소요시간' in b) push('소요시간', asString(b.소요시간).trim());
    if ('인분' in b) push('인분', asString(b.인분).trim());
    if ('맵기' in b) push('맵기', asString(b.맵기).trim());
    if ('아이적합도' in b) push('아이적합도', asNumber(b.아이적합도, 3));
    if ('알레르기' in b) pushJson('알레르기', b.알레르기);
    if ('재료' in b) pushJson('재료', b.재료);
    if ('만드는법' in b) pushJson('만드는법', b.만드는법);
    if ('아이팁' in b) push('아이팁', asString(b.아이팁).trim());
    if ('영양포인트' in b) push('영양포인트', asString(b.영양포인트).trim());
    if ('사용재료' in b) pushJson('사용재료', b.사용재료);

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: '수정할 내용이 없습니다.' });
    }

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE recipes SET ${fields.join(', ')} WHERE "id" = $${i} RETURNING ${RECIPE_COLS}`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 레시피를 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('PATCH /api/recipes/:id:', err.message);
    res.status(500).json({ success: false, message: '레시피를 수정하지 못했습니다.' });
  }
});

// 레시피 삭제.
app.delete('/api/recipes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM recipes WHERE "id" = $1 RETURNING "id"',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 레시피를 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: { id: rows[0].id } });
  } catch (err) {
    console.error('DELETE /api/recipes/:id:', err.message);
    res.status(500).json({ success: false, message: '레시피를 삭제하지 못했습니다.' });
  }
});

// SPA fallback: serve index.html for any non-API GET.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------------------------------------------------------
// Local: start server. Serverless (Vercel): export app.
// ------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`냉장고 관리 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
