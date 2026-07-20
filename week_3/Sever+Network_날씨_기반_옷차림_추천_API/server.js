// ============================================================
// 날씨 기반 옷차림 추천 API — Express 백엔드
// ------------------------------------------------------------
// 1) index.html을 정적으로 서빙합니다.
// 2) GET /recommend 에서 OpenWeatherMap을 서버에서 호출해
//    현재 기온/날씨를 받아오고, 한국 기온별 기준으로 옷차림을 추천합니다.
// 3) 위치는 자동 감지합니다.
//      - 1순위: 브라우저 geolocation이 넘겨준 ?lat=&lon=
//      - 2순위(폴백): 요청 IP로 ip-api.com에서 위치 추정 (키 불필요)
//      - 최후 폴백: 서울 좌표(로컬호스트/사설 IP일 때)
// 4) OpenWeatherMap API 키는 .env에서만 읽어 서버에서만 사용합니다.
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

// .env에 저장된 정확한 키 이름을 그대로 읽고, 흔한 변형도 함께 허용.
// (이 프로젝트의 .env는 OpenWeatherMap_api_key 로 저장되어 있음)
const OWM_API_KEY = (
  process.env.OpenWeatherMap_api_key ||
  process.env.OPENWEATHERMAP_API_KEY ||
  process.env.OPENWEATHER_API_KEY ||
  process.env.OWM_API_KEY ||
  ''
).trim();

// 위치를 전혀 알 수 없을 때 사용하는 기본 좌표 (서울특별시청).
const DEFAULT_LOCATION = { city: '서울특별시', lat: 37.5665, lon: 126.978 };

// 외부 호출 타임아웃 (밀리초)
const FETCH_TIMEOUT_MS = 15000;

const app = express();
app.use(express.json());

// ------------------------------------------------------------
// 2. 정적 파일 서빙
//    - index.html, client.js 등 이 폴더의 자산을 서빙합니다.
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

// 요청에서 클라이언트 IP를 최대한 정확히 추출.
// (프록시 뒤일 수 있으니 x-forwarded-for의 첫 IP를 우선 사용)
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  // IPv6 매핑(::ffff:1.2.3.4) 형태면 IPv4 부분만 추출.
  const raw = (req.socket && req.socket.remoteAddress) || '';
  return raw.replace(/^::ffff:/, '');
}

// 로컬호스트/사설 IP 여부 판단 (ip-api.com이 위치를 못 주는 대역).
function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return true;
  // IPv4 사설 대역: 10.x, 192.168.x, 172.16~31.x
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  // IPv6 사설/링크로컬 대역(fc00::/7, fe80::/10)
  if (/^f[cd]/i.test(ip)) return true;
  if (/^fe80:/i.test(ip)) return true;
  return false;
}

// ------------------------------------------------------------
// 4. 한국 기온별 옷차림 기준
//    현재 기온(°C)을 받아 해당 구간의 추천 의상을 반환.
// ------------------------------------------------------------
const CLOTHING_CHART = [
  { min: 28, max: Infinity, range: '28°C 이상', items: ['민소매', '반팔', '반바지', '원피스'] },
  { min: 23, max: 27, range: '23~27°C', items: ['반팔', '얇은 셔츠', '반바지', '면바지'] },
  { min: 20, max: 22, range: '20~22°C', items: ['얇은 가디건', '긴팔', '면바지', '청바지'] },
  { min: 17, max: 19, range: '17~19°C', items: ['얇은 니트', '가디건', '맨투맨', '청바지'] },
  { min: 12, max: 16, range: '12~16°C', items: ['자켓', '가디건', '야상', '스타킹', '청바지', '면바지'] },
  { min: 9, max: 11, range: '9~11°C', items: ['트렌치코트', '야상', '점퍼', '스타킹', '청바지'] },
  { min: 5, max: 8, range: '5~8°C', items: ['코트', '가죽자켓', '히트텍', '니트', '레깅스'] },
  { min: -Infinity, max: 4, range: '4°C 이하', items: ['패딩', '두꺼운 코트', '목도리', '기모제품'] },
];

function recommendByTemp(tempC) {
  // 기온이 속하는 구간을 찾는다 (정수 경계는 차트 기준 그대로 비교).
  const rounded = Math.round(tempC);
  const found = CLOTHING_CHART.find((row) => rounded >= row.min && rounded <= row.max);
  // 이론상 항상 매칭되지만 안전하게 가장 추운 구간으로 폴백.
  return found || CLOTHING_CHART[CLOTHING_CHART.length - 1];
}

// 날씨 상태(코드/설명)에 따른 짧은 추가 팁 (있으면 좋은 보너스).
//   - OpenWeatherMap weather[0].id 그룹: 2xx 뇌우, 3xx 이슬비, 5xx 비, 6xx 눈, 7xx 안개 등, 8xx 맑음/구름
function buildTip(weatherId, windSpeed) {
  let tip = '';
  if (weatherId >= 200 && weatherId < 600) {
    tip = '비 소식이 있어요. 우산이나 방수 아우터를 챙기세요.';
  } else if (weatherId >= 600 && weatherId < 700) {
    tip = '눈이 와요. 미끄럼 방지 신발과 방수 아우터를 추천해요.';
  } else if (weatherId >= 700 && weatherId < 800) {
    tip = '안개·미세먼지 등으로 시야가 흐릴 수 있어요. 마스크를 챙기면 좋아요.';
  }
  // 강풍(대략 8m/s 이상)이면 바람막이 권장. 위 팁과 합쳐서 안내.
  if (typeof windSpeed === 'number' && windSpeed >= 8) {
    const windTip = '바람이 강하니 바람막이나 여밈이 좋은 겉옷을 챙기세요.';
    tip = tip ? `${tip} ${windTip}` : windTip;
  }
  return tip;
}

// ------------------------------------------------------------
// 5. 위치 확정 로직
//    lat/lon이 쿼리로 오면 그대로 사용(source: 'gps'),
//    없으면 요청 IP로 추정(source: 'ip'),
//    그것도 불가하면 서울 기본값(source: 'default').
// ------------------------------------------------------------
async function resolveLocation(req) {
  const qLat = parseFloat(req.query.lat);
  const qLon = parseFloat(req.query.lon);

  // 1순위: 브라우저가 넘겨준 좌표 (유효한 위/경도 범위인지 검증)
  if (
    Number.isFinite(qLat) &&
    Number.isFinite(qLon) &&
    qLat >= -90 &&
    qLat <= 90 &&
    qLon >= -180 &&
    qLon <= 180
  ) {
    return { city: null, lat: qLat, lon: qLon, source: 'gps' };
  }

  // 2순위: 요청 IP 기반 추정 (사설/로컬 IP면 건너뜀)
  const ip = getClientIp(req);
  if (!isPrivateOrLocalIp(ip)) {
    try {
      const url = `http://ip-api.com/json/${encodeURIComponent(
        ip
      )}?lang=ko&fields=status,message,country,regionName,city,lat,lon`;
      const ipRes = await fetchWithTimeout(url);
      if (ipRes.ok) {
        const data = await ipRes.json();
        if (
          data &&
          data.status === 'success' &&
          Number.isFinite(data.lat) &&
          Number.isFinite(data.lon)
        ) {
          // 도시명은 "구/시 + 나라" 형태로 친절하게 구성.
          const cityName =
            [data.city, data.regionName].filter(Boolean).join(' ') ||
            data.country ||
            null;
          return { city: cityName, lat: data.lat, lon: data.lon, source: 'ip' };
        }
      }
    } catch (err) {
      // IP 위치 추정 실패는 치명적이지 않으므로 기본값으로 폴백.
      console.error('IP 위치 추정 실패:', err && err.message ? err.message : err);
    }
  }

  // 최후 폴백: 서울 기본 좌표
  return { ...DEFAULT_LOCATION, source: 'default' };
}

// ------------------------------------------------------------
// 6. GET /recommend
//    위치 확정 → OpenWeatherMap 현재 날씨 조회 → 옷차림 추천 JSON 반환.
// ------------------------------------------------------------
app.get('/recommend', async (req, res) => {
  // 키가 없으면 외부 호출 자체가 불가하므로 친절히 안내.
  if (!OWM_API_KEY) {
    return res.status(500).json({
      success: false,
      message:
        '서버에 OpenWeatherMap API 키가 설정되어 있지 않아요. .env의 OpenWeatherMap_api_key 값을 확인해 주세요.',
    });
  }

  try {
    // 1) 위치 확정 (gps → ip → default)
    const location = await resolveLocation(req);

    // 2) OpenWeatherMap 현재 날씨 조회 (섭씨 + 한국어 설명)
    const params = new URLSearchParams({
      lat: String(location.lat),
      lon: String(location.lon),
      appid: OWM_API_KEY,
      units: 'metric',
      lang: 'kr',
    });
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?${params.toString()}`;

    let owmRes;
    try {
      owmRes = await fetchWithTimeout(weatherUrl, { headers: { Accept: 'application/json' } });
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      console.error('OpenWeatherMap 호출 오류:', err && err.message ? err.message : err);
      return res.status(aborted ? 504 : 502).json({
        success: false,
        message: aborted
          ? '날씨 정보를 가져오는 데 시간이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.'
          : '날씨 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
      });
    }

    if (!owmRes.ok) {
      // 키/원본 에러는 서버 콘솔에만 기록하고, 클라이언트에는 일반 메시지로 응답.
      let detail = '';
      try {
        detail = (await owmRes.text()).slice(0, 300);
      } catch (_) {
        /* 무시 */
      }
      console.error(`OpenWeatherMap API 오류 ${owmRes.status}: ${detail}`);

      // 401은 키 문제일 가능성이 큼 (신규 키는 활성화에 시간이 걸릴 수 있음).
      if (owmRes.status === 401) {
        return res.status(502).json({
          success: false,
          message:
            'API 키 인증에 실패했어요. 키가 올바른지, 또는 발급 직후라면 활성화(최대 수 시간)가 끝났는지 확인해 주세요.',
        });
      }
      return res.status(502).json({
        success: false,
        message: '날씨 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      });
    }

    const w = await owmRes.json();
    // 응답 형식 검증
    if (!w || !w.main || typeof w.main.temp !== 'number') {
      console.error('OpenWeatherMap 응답 형식이 예상과 다릅니다:', w);
      return res.status(502).json({
        success: false,
        message: '날씨 데이터 형식이 올바르지 않아요. 잠시 후 다시 시도해 주세요.',
      });
    }

    const temp = w.main.temp;
    const feelsLike = typeof w.main.feels_like === 'number' ? w.main.feels_like : temp;
    const weatherInfo = Array.isArray(w.weather) && w.weather[0] ? w.weather[0] : {};
    const description = weatherInfo.description || '정보 없음';
    const icon = weatherInfo.icon || '';
    const weatherId = typeof weatherInfo.id === 'number' ? weatherInfo.id : 800;
    const windSpeed = w.wind && typeof w.wind.speed === 'number' ? w.wind.speed : null;

    // 3) 옷차림 추천
    const reco = recommendByTemp(temp);
    const tip = buildTip(weatherId, windSpeed);

    // IP/기본값으로 위치를 정한 경우, OWM이 돌려준 도시명으로 보강.
    const cityName = location.city || w.name || '알 수 없는 지역';

    return res.json({
      success: true,
      location: {
        city: cityName,
        lat: Math.round(location.lat * 100) / 100,
        lon: Math.round(location.lon * 100) / 100,
        source: location.source, // 'gps' | 'ip' | 'default'
      },
      weather: {
        temp: Math.round(temp * 10) / 10,
        feelsLike: Math.round(feelsLike * 10) / 10,
        description,
        icon,
      },
      recommendation: {
        range: reco.range,
        items: reco.items,
        tip,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('/recommend 처리 중 예기치 못한 오류:', err);
    return res.status(500).json({
      success: false,
      message: '옷차림을 추천하는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    });
  }
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
  console.log(`👕 날씨 기반 옷차림 추천 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  if (!OWM_API_KEY) {
    console.warn('⚠️  OpenWeatherMap API 키가 설정되지 않았습니다. .env의 OpenWeatherMap_api_key를 확인하세요.');
  }
});

module.exports = app;
