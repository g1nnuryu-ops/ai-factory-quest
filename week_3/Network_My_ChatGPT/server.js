// ============================================================
// 나만의 ChatGPT (ESTJ 고용노동부 교육훈련 상담관) — 의존성 0개 백엔드
// index.html을 서빙하고 OpenAI Chat Completions 호출을 서버에서 프록시합니다.
// (API 키가 절대 브라우저로 노출되지 않도록 서버에서만 사용)
// Node.js 18+ 필요 (내장 전역 fetch 사용).
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------
// 1. 작은 .env 로더 (dotenv 의존성 회피)
//    .env의 KEY=VALUE 라인을 process.env로 읽어 옵니다.
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

// OpenAI API 키. .env에 저장된 이름(소문자 openai_api_key)을 그대로 읽고,
// 흔한 변형(OPENAI_API_KEY, OPENAI_KEY)도 함께 허용. trailing newline 방지로 .trim().
const OPENAI_API_KEY = (
  process.env.openai_api_key ||
  process.env.OPENAI_API_KEY ||
  process.env.OPENAI_KEY ||
  ''
).trim();

// 모델은 .env의 OPENAI_MODEL로 바꿀 수 있고, 기본값은 gpt-4o-mini.
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

// ------------------------------------------------------------
// 2. 페르소나 SYSTEM_PROMPT (ESTJ + 고용노동부 교육훈련 전문 상담관)
//    서버가 매 요청마다 messages 맨 앞에 직접 붙입니다(브라우저는 모름).
// ------------------------------------------------------------
const SYSTEM_PROMPT = {
  role: 'system',
  content: [
    "당신은 대한민국 고용노동부 소속 '직업능력개발·교육훈련 전문 상담관'입니다.",
    'MBTI ESTJ 성향으로, 아래 원칙에 따라 답변합니다.',
    '',
    '[성격·말투]',
    '- 결론부터 단호하고 명확하게 말합니다(두괄식).',
    '- 감정적 위로보다 검증된 사실·기준·절차·기한을 우선합니다.',
    '- 1, 2, 3 또는 STEP 단위로 체계적으로 정리합니다.',
    '- 규정과 요건을 정확히 짚고, 모호하게 얼버무리지 않습니다.',
    '- 군더더기 없이 핵심만, 그러나 예의는 갖춥니다.',
    '- 근거가 불확실하면 추측하지 않고 "정확한 확인이 필요합니다"라고 안내하며 공식 창구(고용노동부 고객상담센터 1350, HRD-Net www.hrd.go.kr)를 안내합니다.',
    '',
    '[전문 영역]',
    '국민내일배움카드, 직업훈련 과정, K-디지털 트레이닝, 일학습병행, 고용보험·실업급여 연계 훈련, 기업직업훈련, NCS 기반 훈련 등 고용노동부 교육훈련 제도 전반.',
    '',
    '[답변 형식]',
    '핵심 결론 → 요건/절차 → 주의사항·기한 → 다음 행동 제안 순서로 구성합니다.',
    '주제와 무관한 잡담은 정중히 교육훈련 상담으로 유도합니다.',
  ].join('\n'),
};

// ------------------------------------------------------------
// 3. 정적 파일 서빙 (index.html 및 이 폴더의 자산)
// ------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  // "/"를 index.html로 매핑; path traversal 방지.
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  // .env(또는 이 폴더 바깥)는 절대 서빙하지 않음.
  if (!filePath.startsWith(__dirname) || path.basename(filePath) === '.env') {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ------------------------------------------------------------
// 4. 헬퍼
// ------------------------------------------------------------
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// POST 본문을 직접 모읍니다. 1MB 상한을 넘으면 연결을 끊습니다.
const MAX_BODY_BYTES = 1024 * 1024; // 1MB

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

// 클라이언트가 보낸 대화 기록을 신뢰하지 않고 정제합니다.
// - user/assistant 역할만 허용(system은 서버가 붙이므로 무시)
// - content는 문자열만, 과도한 길이는 컷
// - 너무 긴 히스토리는 최근 20개만 사용
function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  const cleaned = [];
  for (const m of input) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null;
    if (!role) continue;
    if (typeof m.content !== 'string') continue;
    const content = m.content.trim();
    if (!content) continue;
    cleaned.push({ role, content: content.slice(0, 6000) });
  }
  return cleaned.slice(-20);
}

// ------------------------------------------------------------
// 5. POST /api/chat — OpenAI Chat Completions 프록시
//    요청: { messages: [{ role: 'user'|'assistant', content }] }
//    성공: { success: true, reply }
//    실패: { success: false, message }  (한국어 안내, 원본 에러/키는 노출 안 함)
// ------------------------------------------------------------
async function handleChat(req, res) {
  if (!OPENAI_API_KEY) {
    console.error('OpenAI API 키가 설정되지 않았습니다. .env의 openai_api_key를 확인하세요.');
    return sendJson(res, 500, {
      success: false,
      message: '서버에 API 키가 설정되어 있지 않습니다. 관리자에게 문의해 주세요.',
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') {
      return sendJson(res, 413, {
        success: false,
        message: '요청 내용이 너무 깁니다. 대화를 줄여서 다시 시도해 주세요.',
      });
    }
    return sendJson(res, 400, {
      success: false,
      message: '요청 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.',
    });
  }

  const messages = sanitizeMessages(body && body.messages);
  if (messages.length === 0) {
    return sendJson(res, 400, {
      success: false,
      message: '보낼 메시지가 없습니다. 질문을 입력한 뒤 다시 시도해 주세요.',
    });
  }

  // 페르소나 system 프롬프트를 서버가 맨 앞에 직접 붙입니다.
  const payload = {
    model: OPENAI_MODEL,
    messages: [SYSTEM_PROMPT, ...messages],
    temperature: 0.5,
    max_tokens: 900,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20초 타임아웃

    let apiRes;
    try {
      apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!apiRes.ok) {
      // 서버 콘솔에만 로그; 키나 원본 에러를 클라이언트로 노출하지 않음.
      let detail = '';
      try {
        detail = (await apiRes.text()).slice(0, 800);
      } catch (_) {
        /* 무시 */
      }
      console.error(`OpenAI API 오류 ${apiRes.status}: ${detail}`);

      // 상태코드별로 사용자에게 보여줄 한국어 안내만 분기.
      let message = '답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      if (apiRes.status === 401) {
        message = '서버 인증에 문제가 있습니다. 관리자에게 문의해 주세요.';
      } else if (apiRes.status === 429) {
        message = '요청이 많아 잠시 지연되고 있습니다. 잠시 후 다시 시도해 주세요.';
      }
      return sendJson(res, 502, { success: false, message });
    }

    const data = await apiRes.json();
    const reply =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      typeof data.choices[0].message.content === 'string'
        ? data.choices[0].message.content.trim()
        : '';

    if (!reply) {
      console.error('OpenAI 응답에서 답변 텍스트를 찾지 못했습니다:', JSON.stringify(data).slice(0, 800));
      return sendJson(res, 502, {
        success: false,
        message: '답변을 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }

    return sendJson(res, 200, { success: true, reply });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('채팅 핸들러 오류:', err);
    return sendJson(res, aborted ? 504 : 500, {
      success: false,
      message: aborted
        ? '응답이 너무 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.'
        : '답변을 생성하는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}

// ------------------------------------------------------------
// 6. 라우터 + 서버
// ------------------------------------------------------------
const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  if (pathname === '/api/chat') {
    if (req.method !== 'POST') {
      return sendJson(res, 405, {
        success: false,
        message: 'POST 요청만 지원합니다.',
      });
    }
    return handleChat(req, res);
  }

  if (req.method === 'GET') {
    return serveStatic(req, res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log(`🤖 나만의 ChatGPT(ESTJ 교육훈련 상담관) 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log(`   모델: ${OPENAI_MODEL}`);
  if (!OPENAI_API_KEY) {
    console.warn('⚠️  OpenAI API 키가 설정되지 않았습니다. .env의 openai_api_key를 확인하세요.');
  }
});
