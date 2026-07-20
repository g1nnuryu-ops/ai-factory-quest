// ============================================================
// AI 별명 생성기 — Express 백엔드
// ------------------------------------------------------------
// 1) index.html을 정적으로 서빙합니다. (.env 등 숨김 파일은 보호)
// 2) POST /api/nickname 에서 사용자가 입력한 이름/성격/취미/키워드와
//    원하는 분위기(style)를 받아 OpenAI Chat Completions를 서버에서
//    호출하고, 재미있는 한국어 별명 여러 개를 만들어 돌려줍니다.
// 3) OpenAI API 키는 .env에서만 읽어 서버에서만 사용합니다.
//    절대 브라우저로 노출하지 않고, .env를 정적으로 서빙하지 않습니다.
//
// Node.js 18+ 필요 (내장 전역 fetch 사용). Express 의존성 1개.
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------
// 1. 작은 .env 로더 (dotenv 의존성 회피)
//    .env의 KEY=VALUE 라인을 process.env로 읽어 옵니다.
//    (형제 프로젝트 Sever+Network_날씨_기반_옷차림_추천_API와 동일)
// ------------------------------------------------------------
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // 양옆을 감싼 따옴표는 제거
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const PORT = (process.env.PORT || '3000').trim();

// .env에 저장된 정확한 키 이름(openai_api_key)을 그대로 읽고,
// 흔한 변형(OPENAI_API_KEY, OPENAI_KEY)도 폴백으로 허용.
// .trim()으로 trailing newline / 공백 문제를 방지.
const OPENAI_API_KEY = (
  process.env.openai_api_key ||
  process.env.OPENAI_API_KEY ||
  process.env.OPENAI_KEY ||
  ''
).trim();

// 사용할 OpenAI 모델 (.env의 OPENAI_MODEL로 덮어쓸 수 있음).
// gpt-4o-mini: 저렴하고 빠르며 이 용도에 적합.
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

// OpenAI 호출 타임아웃 (밀리초)
const FETCH_TIMEOUT_MS = 30000;

// 별명 개수 기본값 / 허용 범위
const DEFAULT_COUNT = 6;
const MIN_COUNT = 1;
const MAX_COUNT = 10;

// style 기본값
const DEFAULT_STYLE = '유쾌한';

const app = express();
app.use(express.json());

// ------------------------------------------------------------
// 2. 정적 파일 서빙
//    - index.html 등 이 폴더의 자산을 서빙합니다.
//    - .env(또는 .으로 시작하는 숨김 파일)는 절대 서빙하지 않습니다.
// ------------------------------------------------------------
app.use(
  express.static(path.join(__dirname), {
    // 점(.)으로 시작하는 파일(.env 등)은 정적으로 노출하지 않음.
    dotfiles: 'deny',
    index: 'index.html',
  })
);

// ------------------------------------------------------------
// 3. 공통 헬퍼
// ------------------------------------------------------------

// AbortController 타임아웃을 적용한 fetch.
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 입력값을 안전한 문자열로 정규화 (문자열이 아니면 빈 문자열, 과도한 길이는 컷).
function cleanStr(value, maxLen = 200) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

// count를 1~10 정수로 클램프 (이상값은 기본값으로).
function clampCount(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_COUNT;
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, n));
}

// OpenAI가 돌려준 nicknames 배열을 우리 계약 형태로 정규화.
//   - 각 항목에 nickname/reason 문자열을 보장
//   - 둘 중 하나라도 비어있는 비정상 항목은 제거
//   - 최대 count개로 제한
function normalizeNicknames(rawList, count) {
  if (!Array.isArray(rawList)) return [];
  const result = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const nickname = cleanStr(item.nickname, 60);
    const reason = cleanStr(item.reason, 200);
    if (!nickname) continue; // 별명이 없으면 무의미하므로 제외
    result.push({
      nickname,
      // reason이 비면 빈 문자열 대신 친절한 기본 문구로.
      reason: reason || '입력하신 정보를 살려 지은 별명이에요.',
    });
    if (result.length >= count) break;
  }
  return result;
}

// ------------------------------------------------------------
// 4. 프롬프트 구성
//    system: 작명가 역할 + JSON 출력 강제 지시
//    user: 입력값 + 생성 개수(N)
// ------------------------------------------------------------
function buildSystemPrompt() {
  return [
    '너는 센스있는 한국어 별명 작명가야.',
    '입력된 사람 정보(이름/성격/취미/키워드)와 원하는 분위기(style)를 반영해서',
    '재미있고 개성있는 한국어 별명을 정확히 N개 만들어.',
    '반드시 {"nicknames":[{"nickname":"...","reason":"..."}]} 형태의 JSON만 출력해.',
    'nickname은 너무 길지 않게(보통 2~8글자) 만들고, 서로 겹치지 않게 다양하게 지어.',
    'reason은 한국어 한 문장으로 짧고 재치있게 작성해.',
    '입력 정보가 부족하면 이름 자체의 어감이나 분위기(style)를 살려서 창의적으로 지어.',
  ].join(' ');
}

function buildUserPrompt({ name, personality, hobbies, keywords, style, count }) {
  // 입력값을 라벨과 함께 정리. 비어있는 항목은 '(없음)'으로 표기해 모델이 혼동하지 않게.
  const lines = [
    `이름: ${name}`,
    `성격: ${personality || '(없음)'}`,
    `취미: ${hobbies || '(없음)'}`,
    `추가 특징/키워드: ${keywords || '(없음)'}`,
    `원하는 별명 분위기(style): ${style}`,
    '',
    `위 사람에게 어울리는 "${style}" 분위기의 한국어 별명을 정확히 ${count}개 만들어 줘.`,
    `반드시 {"nicknames":[{"nickname":"...","reason":"..."}]} 형태의 JSON으로만, 항목 ${count}개를 채워서 응답해.`,
  ];
  return lines.join('\n');
}

// ------------------------------------------------------------
// 5. POST /api/nickname
//    입력 검증 → OpenAI 호출 → JSON 파싱/정규화 → 별명 목록 반환.
// ------------------------------------------------------------
app.post('/api/nickname', async (req, res) => {
  // 키가 없으면 외부 호출 자체가 불가하므로 친절히 안내.
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      success: false,
      message:
        '서버에 OpenAI API 키가 설정되어 있지 않아요. .env의 openai_api_key 값을 확인해 주세요.',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // 1) 입력 정규화 + 필수값(name) 검증
  const name = cleanStr(body.name, 50);
  if (!name) {
    return res.status(400).json({
      success: false,
      message: '이름을 입력해 주세요. 별명을 지으려면 이름이 필요해요.',
    });
  }

  const personality = cleanStr(body.personality, 200);
  const hobbies = cleanStr(body.hobbies, 200);
  const keywords = cleanStr(body.keywords, 200);
  const style = cleanStr(body.style, 30) || DEFAULT_STYLE;
  const count = clampCount(body.count);

  // 2) OpenAI Chat Completions 호출
  const payload = {
    model: OPENAI_MODEL,
    // JSON 강제 출력으로 파싱 안정화
    response_format: { type: 'json_object' },
    temperature: 0.9, // 창의성 확보
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: buildUserPrompt({ name, personality, hobbies, keywords, style, count }),
      },
    ],
  };

  let openaiRes;
  try {
    openaiRes = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // 타임아웃/네트워크 오류 — 원본 상세는 서버 콘솔에만 기록.
    const aborted = err && err.name === 'AbortError';
    console.error('OpenAI 호출 오류:', err && err.message ? err.message : err);
    return res.status(aborted ? 504 : 502).json({
      success: false,
      message: aborted
        ? '별명을 만드는 데 시간이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.'
        : 'AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  // 3) 상태 코드별 처리 (원본 에러는 콘솔에만, 클라이언트엔 일반 메시지)
  if (!openaiRes.ok) {
    let detail = '';
    try {
      detail = (await openaiRes.text()).slice(0, 500);
    } catch (_) {
      /* 무시 */
    }
    console.error(`OpenAI API 오류 ${openaiRes.status}: ${detail}`);

    // 401: 키 인증 실패 (키가 잘못되었거나 만료/취소됨)
    if (openaiRes.status === 401) {
      return res.status(502).json({
        success: false,
        message:
          'OpenAI API 키 인증에 실패했어요. .env의 openai_api_key가 올바른지 확인해 주세요.',
      });
    }
    // 429: 요청 한도/쿼터 초과
    if (openaiRes.status === 429) {
      return res.status(502).json({
        success: false,
        message:
          'OpenAI 사용 한도(또는 잔액)를 초과했어요. 잠시 후 다시 시도하거나 결제 상태를 확인해 주세요.',
      });
    }
    return res.status(502).json({
      success: false,
      message: 'AI가 별명을 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  // 4) 응답 파싱 + 정규화
  let data;
  try {
    data = await openaiRes.json();
  } catch (err) {
    console.error('OpenAI 응답 JSON 파싱 실패:', err && err.message ? err.message : err);
    return res.status(502).json({
      success: false,
      message: 'AI 응답을 이해하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  const content =
    data &&
    Array.isArray(data.choices) &&
    data.choices[0] &&
    data.choices[0].message &&
    typeof data.choices[0].message.content === 'string'
      ? data.choices[0].message.content
      : '';

  if (!content) {
    console.error('OpenAI 응답에 content가 없습니다:', JSON.stringify(data).slice(0, 500));
    return res.status(502).json({
      success: false,
      message: 'AI가 빈 응답을 보냈어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  // content는 JSON 문자열 — 파싱해서 nicknames 배열을 꺼낸다.
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error('OpenAI content JSON.parse 실패:', content.slice(0, 500));
    return res.status(502).json({
      success: false,
      message: 'AI가 만든 별명을 정리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  const nicknames = normalizeNicknames(parsed && parsed.nicknames, count);

  if (nicknames.length === 0) {
    console.error('정규화 후 유효한 별명이 없습니다:', content.slice(0, 500));
    return res.status(502).json({
      success: false,
      message: 'AI가 별명을 제대로 만들지 못했어요. 입력을 조금 바꿔서 다시 시도해 주세요.',
    });
  }

  // 5) 성공 응답 (계약 형태 그대로)
  return res.json({
    success: true,
    nicknames,
  });
});

// ------------------------------------------------------------
// 6. SPA 폴백 — 정적으로 못 찾은 GET 요청은 index.html로.
//    (Express 5의 path-to-regexp v6 문법: 명명 와일드카드 사용)
// ------------------------------------------------------------
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------------------------------------------------------
// 7. 서버 시작
// ------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✨ AI 별명 생성기 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  if (!OPENAI_API_KEY) {
    console.warn('⚠️  OpenAI API 키가 설정되지 않았습니다. .env의 openai_api_key를 확인하세요.');
  }
});

module.exports = app;
