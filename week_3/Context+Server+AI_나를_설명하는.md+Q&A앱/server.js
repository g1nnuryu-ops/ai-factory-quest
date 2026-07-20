// ============================================================
// 나를 설명하는 Q&A 앱 — Express 백엔드
// ------------------------------------------------------------
// 1) index.html을 정적으로 서빙합니다. (.env / about-me.md는 보호)
// 2) POST /api/ask 에서 사용자의 질문(question)과 이전 대화(history)를
//    받아, about-me.md(류건우의 프로필/페르소나)를 시스템 프롬프트에
//    주입한 뒤 OpenAI Chat Completions를 서버에서 호출하고,
//    류건우에 대한 한국어 답변을 돌려줍니다.
// 3) OpenAI API 키는 .env에서만 읽어 서버에서만 사용합니다.
//    절대 브라우저로 노출하지 않고, .env / about-me.md를
//    정적으로 서빙하지 않습니다.
//
// Node.js 18+ 필요 (내장 전역 fetch 사용). Express 의존성 1개.
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------
// 1. 작은 .env 로더 (dotenv 의존성 회피)
//    .env의 KEY=VALUE 라인을 process.env로 읽어 옵니다.
//    (형제 프로젝트 Server+AI_AI별명생성기와 동일)
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

// 입력 제한값
const MAX_QUESTION_LEN = 2000; // 질문 1개 최대 길이
const MAX_HISTORY_TURNS = 10; // 직전 대화 최대 보존 턴 수
const MAX_HISTORY_CONTENT_LEN = 4000; // 대화 1개 content 최대 길이

const app = express();
app.use(express.json());

// ------------------------------------------------------------
// 2. 민감 파일 접근 차단 (정적 미들웨어보다 먼저)
//    about-me.md는 .으로 시작하지 않는 일반 파일이라 dotfiles 옵션으로
//    막히지 않으므로, 여기서 명시적으로 404 처리해 원문 다운로드를 방지.
//    .env도 한 번 더 방어적으로 차단.
// ------------------------------------------------------------
app.use((req, res, next) => {
  // 쿼리스트링/대소문자 차이를 무시하기 위해 경로만 소문자로 비교.
  const p = req.path.toLowerCase();
  if (p === '/about-me.md' || p === '/.env') {
    return res.status(404).json({ success: false, message: '찾을 수 없어요.' });
  }
  next();
});

// ------------------------------------------------------------
// 3. 정적 파일 서빙
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
// 4. 공통 헬퍼
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
function cleanStr(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

// 클라이언트가 보낸 history를 안전하게 정규화.
//   - 배열이 아니면 빈 배열
//   - role이 'user'/'assistant'가 아닌 항목은 제거
//   - content가 비어있는 항목은 제거
//   - 각 content는 길이 제한, 마지막 N턴만 보존 (오래된 것부터 잘라냄)
function sanitizeHistory(rawList) {
  if (!Array.isArray(rawList)) return [];
  const cleaned = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role === 'user' || item.role === 'assistant' ? item.role : null;
    if (!role) continue;
    const content = cleanStr(item.content, MAX_HISTORY_CONTENT_LEN);
    if (!content) continue;
    cleaned.push({ role, content });
  }
  // 최근 대화 우선: 뒤에서 MAX_HISTORY_TURNS개만 남긴다.
  return cleaned.slice(-MAX_HISTORY_TURNS);
}

// about-me.md를 요청 시점에 새로 읽는다.
//   - 성공: 마크다운 전체 문자열
//   - 실패: null (프로필 없이도 답변은 진행)
function readProfile() {
  try {
    return fs.readFileSync(path.join(__dirname, 'about-me.md'), 'utf8');
  } catch (err) {
    console.error('about-me.md 읽기 실패:', err && err.message ? err.message : err);
    return null;
  }
}

// ------------------------------------------------------------
// 5. 프롬프트 구성
//    system: 류건우를 잘 아는 AI 역할 + 프로필(about-me.md) 주입
// ------------------------------------------------------------
function buildSystemPrompt(profile) {
  const lines = [
    '너는 "류건우"라는 사람을 아주 잘 아는 AI야.',
    '사용자가 류건우에 대해 무엇이든(직장/커리어, 부동산 투자, 을지로 바 "계영배",',
    '대학원, 가족, 45세 은퇴 목표, 성격과 가치관 등) 물어보면 친절하게 답해.',
    '항상 따뜻하고 자연스러운 한국어로, 간결하면서도 구체적으로 답해.',
    '필요하면 줄바꿈이나 간단한 불릿(-)으로 읽기 좋게 정리해도 좋아.',
    '',
    '아래는 류건우에 대한 권위있는 프로필 정보야. 답변은 이 프로필을 근거로 해.',
    '프로필에 없는 내용을 물어보면, 알고 있는 사실에서 합리적으로 추론해 말하거나',
    '확실하지 않다고 솔직히 말해. 구체적인 수치/주소 같은 사실을 지어내지 마.',
    '',
    '--- 프로필 시작 ---',
    profile && profile.trim()
      ? profile
      : '(프로필 파일을 불러오지 못했습니다. 일반적인 지식과 대화 맥락만으로 신중히 답하고, 확실하지 않은 부분은 솔직히 모른다고 말하세요.)',
    '--- 프로필 끝 ---',
  ];
  return lines.join('\n');
}

// ------------------------------------------------------------
// 6. POST /api/ask
//    입력 검증 → 프로필 로드 → 메시지 구성 → OpenAI 호출 → 답변 반환.
// ------------------------------------------------------------
app.post('/api/ask', async (req, res) => {
  // 키가 없으면 외부 호출 자체가 불가하므로 친절히 안내.
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      success: false,
      message:
        '서버에 OpenAI API 키가 설정되어 있지 않아요. .env의 openai_api_key 값을 확인해 주세요.',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // 1) 입력 정규화 + 필수값(question) 검증
  const question = cleanStr(body.question, MAX_QUESTION_LEN);
  if (!question) {
    return res.status(400).json({
      success: false,
      message: '질문을 입력해 주세요.',
    });
  }

  const history = sanitizeHistory(body.history);

  // 2) 프로필(about-me.md)을 요청 시점에 새로 읽어 시스템 프롬프트에 주입
  const profile = readProfile();

  // 3) 메시지 구성: system → (정리된 history) → 새 질문
  const messages = [
    { role: 'system', content: buildSystemPrompt(profile) },
    ...history,
    { role: 'user', content: question },
  ];

  // 4) OpenAI Chat Completions 호출 (자유 형식 한국어 답변이므로 JSON 강제 X)
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.7,
    messages,
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
        ? '답변을 만드는 데 시간이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.'
        : 'AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  // 5) 상태 코드별 처리 (원본 에러는 콘솔에만, 클라이언트엔 일반 메시지)
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
      message: 'AI가 답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  // 6) 응답 파싱
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

  const answer =
    data &&
    Array.isArray(data.choices) &&
    data.choices[0] &&
    data.choices[0].message &&
    typeof data.choices[0].message.content === 'string'
      ? data.choices[0].message.content.trim()
      : '';

  if (!answer) {
    console.error('OpenAI 응답에 content가 없습니다:', JSON.stringify(data).slice(0, 500));
    return res.status(502).json({
      success: false,
      message: 'AI가 빈 응답을 보냈어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  // 7) 성공 응답 (계약 형태 그대로)
  return res.json({
    success: true,
    answer,
  });
});

// ------------------------------------------------------------
// 7. SPA 폴백 — 정적으로 못 찾은 GET 요청은 index.html로.
//    (Express 5의 path-to-regexp v6 문법: 명명 와일드카드 사용)
// ------------------------------------------------------------
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------------------------------------------------------
// 8. 서버 시작
// ------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🙋 나를 설명하는 Q&A 앱 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  if (!OPENAI_API_KEY) {
    console.warn('⚠️  OpenAI API 키가 설정되지 않았습니다. .env의 openai_api_key를 확인하세요.');
  }
});

module.exports = app;
