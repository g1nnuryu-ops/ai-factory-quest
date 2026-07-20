// ============================================================
// 나만의 Midjourney (신윤복 풍속화 스타일 이미지 생성) — 의존성 0개 백엔드
// index.html을 서빙하고 OpenAI Images(생성) 호출을 서버에서 프록시합니다.
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

// 이미지 모델/크기/품질은 .env로 바꿀 수 있습니다.
// 기본 모델은 gpt-image-1 (이 계정에서 사용 가능한 OpenAI 이미지 모델).
const OPENAI_IMAGE_MODEL = (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1').trim();
// gpt-image-1 지원 크기: 1024x1024 | 1024x1536 | 1536x1024 | auto
const IMAGE_SIZE = (process.env.IMAGE_SIZE || '1024x1024').trim();
// gpt-image-1 품질: low | medium | high | auto (기본 medium — 품질/비용 균형)
const IMAGE_QUALITY = (process.env.IMAGE_QUALITY || 'medium').trim();

// ------------------------------------------------------------
// 2. 화풍(신윤복 풍속화) 지시문 — 앱의 "화풍"은 서버가 소유합니다.
//    서버가 매 요청마다 사용자 프롬프트를 이 템플릿에 끼워 합성합니다(브라우저는 모름).
// ------------------------------------------------------------
const STYLE_TEMPLATE = [
  '신윤복(申潤福, 조선 후기 풍속화가)의 풍속화 스타일로 그린 한 폭의 그림.',
  '- 조선시대 한국 전통 회화. 한지 또는 비단 위에 그린 듯한 질감.',
  '- 가늘고 유려한 철선묘 먹선, 은은한 담채(연한 광물 안료) 채색.',
  '- 차분한 흙빛 배경에 붉은색·청색·옥색의 절제된 포인트 색.',
  '- 한복을 입은 인물, 조선시대의 일상과 풍류 장면.',
  '- 여백을 살린 평면적인 동양화 구도. 사진처럼 사실적이지 않고 전통 붓그림 느낌.',
  '- 현대적 요소(자동차, 전자기기, 영어 글자 등) 절대 포함 금지. 그림 안에 글자/워터마크 금지.',
  '',
  '위 화풍으로 다음 장면을 묘사: "<USER_PROMPT>"',
].join('\n');

// 사용자 프롬프트 최대 길이(과도하게 길면 잘라냄)
const MAX_PROMPT_CHARS = 1000;

function buildStyledPrompt(userPrompt) {
  return STYLE_TEMPLATE.replace('<USER_PROMPT>', userPrompt);
}

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

// POST 본문을 직접 모읍니다. 요청은 작으므로(prompt 문자열뿐) 1MB 상한이면 충분합니다.
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

// ------------------------------------------------------------
// 5. POST /api/generate — OpenAI Images(생성) 프록시
//    요청: { prompt: string }  — 사용자가 입력창에 적은 원본 텍스트
//    성공: { success: true, image: "data:image/png;base64,...", revisedPrompt }
//    실패: { success: false, message }  (한국어 안내, 원본 에러/키는 노출 안 함)
// ------------------------------------------------------------
async function handleGenerate(req, res) {
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
        message: '요청 내용이 너무 깁니다. 설명을 줄여서 다시 시도해 주세요.',
      });
    }
    return sendJson(res, 400, {
      success: false,
      message: '요청 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.',
    });
  }

  // prompt 검증: 문자열이 아니거나 비어 있으면 400.
  const rawPrompt = body && typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!rawPrompt) {
    return sendJson(res, 400, {
      success: false,
      message: '그리고 싶은 장면을 입력한 뒤 다시 시도해 주세요.',
    });
  }

  // 과도하게 길면 잘라냅니다(에러 대신 안전하게 컷).
  const userPrompt = rawPrompt.slice(0, MAX_PROMPT_CHARS);

  // 신윤복 화풍 지시문에 사용자 입력을 끼워 최종 프롬프트를 합성.
  const styledPrompt = buildStyledPrompt(userPrompt);

  // 참고: 이미지 엔드포인트는 더 이상 response_format 파라미터를 받지 않습니다.
  // (보내면 400 'Unknown parameter' 오류) 모델별 기본 형식으로 응답을 받고,
  // 아래에서 b64_json/url 두 경우를 모두 처리해 data URL로 통일합니다.
  const payload = {
    model: OPENAI_IMAGE_MODEL,
    prompt: styledPrompt,
    n: 1,
    size: IMAGE_SIZE,
    quality: IMAGE_QUALITY,
  };

  try {
    // 이미지 생성은 느립니다(20~30초). 타임아웃을 넉넉히 60초로 둡니다.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    let apiRes;
    try {
      apiRes = await fetch('https://api.openai.com/v1/images/generations', {
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
      console.error(`OpenAI Images API 오류 ${apiRes.status}: ${detail}`);

      // 상태코드별로 사용자에게 보여줄 한국어 안내만 분기.
      let message = '이미지를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      if (apiRes.status === 401) {
        message = '서버 인증에 문제가 있습니다. 관리자에게 문의해 주세요.';
      } else if (apiRes.status === 429) {
        message = '요청이 많아 잠시 지연되고 있습니다. 잠시 후 다시 시도해 주세요.';
      } else if (apiRes.status === 400) {
        // content_policy 위반 등 — 안전 정책에 걸린 경우를 포함해 안내.
        message =
          '요청한 내용으로는 이미지를 만들 수 없습니다. 다른 표현으로 다시 시도해 주세요.';
      }
      return sendJson(res, 502, { success: false, message });
    }

    const data = await apiRes.json();
    const first = data && Array.isArray(data.data) ? data.data[0] : null;
    const revisedPrompt =
      first && typeof first.revised_prompt === 'string' ? first.revised_prompt : '';

    // 응답에서 이미지를 data URL로 확보합니다(클라이언트 계약 = 완성된 data URL).
    // - gpt-image-1 등은 b64_json을 바로 줍니다.
    // - dall-e-3는 기본적으로 이미지 URL을 주므로, 서버가 받아 base64로 변환합니다
    //   (URL 만료/CORS 문제를 피하고, 프론트는 <img src>/다운로드 href에 그대로 사용).
    let image = '';
    if (first && typeof first.b64_json === 'string' && first.b64_json) {
      image = `data:image/png;base64,${first.b64_json}`;
    } else if (first && typeof first.url === 'string' && first.url) {
      try {
        const dlController = new AbortController();
        const dlTimeout = setTimeout(() => dlController.abort(), 30000);
        let imgRes;
        try {
          imgRes = await fetch(first.url, { signal: dlController.signal });
        } finally {
          clearTimeout(dlTimeout);
        }
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const ct = (imgRes.headers.get('content-type') || 'image/png')
            .split(';')[0]
            .trim();
          image = `data:${ct};base64,${buf.toString('base64')}`;
        } else {
          console.error(`생성 이미지 URL 다운로드 실패: HTTP ${imgRes.status}`);
        }
      } catch (e) {
        console.error('생성 이미지 URL 다운로드 오류:', e);
      }
    }

    if (!image) {
      console.error(
        'OpenAI 응답에서 이미지 데이터를 찾지 못했습니다:',
        JSON.stringify(data).slice(0, 800)
      );
      return sendJson(res, 502, {
        success: false,
        message: '이미지를 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }

    return sendJson(res, 200, { success: true, image, revisedPrompt });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('이미지 생성 핸들러 오류:', err);
    return sendJson(res, aborted ? 504 : 500, {
      success: false,
      message: aborted
        ? '이미지 생성이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
        : '이미지를 생성하는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}

// ------------------------------------------------------------
// 6. 라우터 + 서버
// ------------------------------------------------------------
const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  if (pathname === '/api/generate') {
    if (req.method !== 'POST') {
      return sendJson(res, 405, {
        success: false,
        message: 'POST 요청만 지원합니다.',
      });
    }
    return handleGenerate(req, res);
  }

  if (req.method === 'GET') {
    return serveStatic(req, res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log(`🎨 나만의 Midjourney(신윤복 풍속화 스타일) 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log(`   이미지 모델: ${OPENAI_IMAGE_MODEL} (크기: ${IMAGE_SIZE}, 품질: ${IMAGE_QUALITY})`);
  if (!OPENAI_API_KEY) {
    console.warn('⚠️  OpenAI API 키가 설정되지 않았습니다. .env의 openai_api_key를 확인하세요.');
  }
});
