// ============================================================
// 실시간 코인 시세 대시보드 — 의존성 0개 백엔드
// index.html을 서빙하고 CoinGecko 시세 요청을 서버에서 프록시합니다.
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
// CoinGecko Demo 키. .env에 저장된 이름을 그대로 읽고, 흔한 변형도 함께 허용.
const COINGECKO_API_KEY = (
  process.env.COINGECKO_API_KEY ||
  process.env.COINGECKO_API_Key ||
  process.env.COINGECKO_KEY ||
  ''
).trim();

// 시가총액 상위 N개 코인을 조회 (CoinGecko market_cap_desc 순).
// .env의 TOP_N으로 조정 가능. CoinGecko per_page 한도(250) 안으로 제한.
const TOP_N = Math.max(1, Math.min(250, parseInt(process.env.TOP_N || '50', 10) || 50));

// ------------------------------------------------------------
// 2. 정적 파일 서빙 (index.html 및 이 폴더의 자산)
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
// 3. 헬퍼
// ------------------------------------------------------------
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// ------------------------------------------------------------
// 4. /api/prices — CoinGecko /coins/markets 프록시
//    응답: { success: true, coins: [{ id, name, symbol, image, price, change24h }], updatedAt }
//    키는 서버에서만 사용하여 브라우저로 노출되지 않습니다.
// ------------------------------------------------------------
async function handlePrices(req, res) {
  const params = new URLSearchParams({
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: String(TOP_N),
    page: '1',
    price_change_percentage: '24h',
    sparkline: 'false',
  });
  const url = `https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`;

  const headers = { Accept: 'application/json' };
  // 키가 있을 때만 Demo 키 헤더를 추가 (없어도 공개 엔드포인트로 동작).
  if (COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let apiRes;
    try {
      apiRes = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!apiRes.ok) {
      // 서버 콘솔에만 로그; 키나 원본 에러를 클라이언트로 노출하지 않음.
      let detail = '';
      try {
        detail = (await apiRes.text()).slice(0, 500);
      } catch (_) {
        /* 무시 */
      }
      console.error(`CoinGecko API 오류 ${apiRes.status}: ${detail}`);
      return sendJson(res, 502, {
        success: false,
        message: '코인 시세를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      });
    }

    const data = await apiRes.json();
    if (!Array.isArray(data)) {
      console.error('CoinGecko 응답 형식이 예상과 다릅니다:', data);
      return sendJson(res, 502, {
        success: false,
        message: '시세 데이터 형식이 올바르지 않아요. 잠시 후 다시 시도해 주세요.',
      });
    }

    // 프론트가 쓰기 쉬운 형태로 정리. CoinGecko가 시총 순으로 반환하므로 순서 유지.
    const coins = data
      .filter((c) => c && c.id)
      .map((c) => ({
        id: c.id,
        rank: c.market_cap_rank,
        name: c.name,
        symbol: c.symbol,
        image: c.image,
        price: c.current_price,
        change24h: c.price_change_percentage_24h,
      }));

    if (coins.length === 0) {
      return sendJson(res, 502, {
        success: false,
        message: '코인 정보를 찾지 못했어요. 잠시 후 다시 시도해 주세요.',
      });
    }

    return sendJson(res, 200, {
      success: true,
      coins,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('시세 핸들러 오류:', err);
    return sendJson(res, aborted ? 504 : 500, {
      success: false,
      message: aborted
        ? '응답이 너무 늦어지고 있어요. 잠시 후 다시 시도해 주세요.'
        : '시세를 불러오는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    });
  }
}

// ------------------------------------------------------------
// 5. 라우터 + 서버
// ------------------------------------------------------------
const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  if (pathname === '/api/prices') {
    if (req.method !== 'GET') {
      return sendJson(res, 405, {
        success: false,
        message: 'GET 요청만 지원해요.',
      });
    }
    return handlePrices(req, res);
  }

  if (req.method === 'GET') {
    return serveStatic(req, res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log(`💰 실시간 코인 시세 대시보드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log(`   조회 대상: 시가총액 상위 ${TOP_N}개 코인`);
  if (!COINGECKO_API_KEY) {
    console.warn('⚠️  CoinGecko API 키가 설정되지 않았습니다. 공개 엔드포인트로 동작하지만 .env 설정을 권장합니다.');
  }
});
