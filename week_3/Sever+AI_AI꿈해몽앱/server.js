// ============================================================
// AI 꿈해몽 — Express 백엔드
// ------------------------------------------------------------
// 1) index.html을 정적으로 서빙합니다. (.env 등 숨김 파일은 보호)
// 2) POST /api/interpret 에서 사용자가 입력한 어젯밤 꿈 내용을 받아
//    OpenAI Chat Completions를 서버에서 호출하고, "서울에 자가 있는
//    김부장" 페르소나의 꿈해몽 결과(길몽/흉몽 판정 + 조언)를 만들어
//    돌려줍니다.
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

// 꿈 입력 길이 제약
const MIN_DREAM_LEN = 2;     // 너무 짧으면 해몽이 무의미
const MAX_DREAM_LEN = 2000;  // 너무 길면 안전하게 컷

// verdict 허용 값 (이 셋 외에는 보정)
const VALID_VERDICTS = ['길몽', '흉몽', '반길몽반흉몽'];

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

// verdict를 허용된 세 값 중 하나로 강제 보정.
//   - 정확히 일치하면 그대로
//   - 부분 문자열/유사 표현이면 가장 가까운 값으로
//   - 도저히 모르면 '반길몽반흉몽'(중립)
function normalizeVerdict(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (VALID_VERDICTS.includes(v)) return v;
  // 반반 계열을 먼저 잡는다 ('반길몽반흉몽', '반반', '중립' 등)
  if (/반/.test(v) || /중립|애매|반반/.test(v)) return '반길몽반흉몽';
  // '길'이 들어가고 '흉'이 없으면 길몽
  if (/길/.test(v) && !/흉/.test(v)) return '길몽';
  // '흉'이 들어가고 '길'이 없으면 흉몽
  if (/흉|나쁜|불길/.test(v) && !/길/.test(v)) return '흉몽';
  // 영어/기타 단서
  if (/good|lucky|positive/i.test(v)) return '길몽';
  if (/bad|ominous|negative/i.test(v)) return '흉몽';
  return '반길몽반흉몽';
}

// score를 0~100 정수로 clamp. 값이 없거나 비정상이면
// verdict로부터 합리적 기본값(길몽↑ / 흉몽↓ / 반반 중간)을 만든다.
function normalizeScore(raw, verdict) {
  const n = Math.round(Number(raw));
  if (Number.isFinite(n)) {
    return Math.max(0, Math.min(100, n));
  }
  // 기본값
  if (verdict === '길몽') return 80;
  if (verdict === '흉몽') return 25;
  return 50; // 반길몽반흉몽
}

// 모델이 준 결과 객체를 우리 계약 형태로 강제 정규화.
// 항상 6개 필드를 가진 안전한 객체를 반환.
function normalizeResult(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};

  const verdict = normalizeVerdict(obj.verdict);
  const score = normalizeScore(obj.score, verdict);

  const title =
    cleanStr(obj.title, 80) || '오늘의 꿈, 김부장이 봐줬네';
  const interpretation =
    cleanStr(obj.interpretation, 1000) ||
    '어이 자네, 이 꿈은 말이야 큰 탈은 없어 보이는구먼. 나 때는 이런 꿈 꾸면 그냥 툭툭 털고 출근했어.';
  const advice =
    cleanStr(obj.advice, 500) ||
    '별거 아니니 마음 단단히 먹고 자네 할 일이나 똑바로 하게. 그게 인생이야.';
  const luckyItem = cleanStr(obj.luckyItem, 60) || '따뜻한 아메리카노';

  return { verdict, score, title, interpretation, advice, luckyItem };
}

// ------------------------------------------------------------
// 4. 프롬프트 구성
//    system: "서울 자가 김부장" 페르소나 + JSON 출력 강제 지시
//    user: 사용자의 꿈 내용 + 스키마 재확인
// ------------------------------------------------------------
function buildSystemPrompt() {
  return [
    '너는 "서울에 자가(아파트) 있는 50대 꼰대 아저씨 김부장"이라는 캐릭터로 꿈을 해몽해 주는 AI야.',
    '',
    '[말투/성격]',
    '- 상대를 "자네", "어이 김대리", "신입", "요즘 젊은 것들" 같이 부르며 반말·하대로 말한다.',
    '- 약간 거들먹거리고 가르치려 든다. "나 때는 말이야", "내가 왕년에", "요즘 젊은 것들은 말이야" 같은 표현을 자연스럽게 섞는다.',
    '- 틈틈이 서울 자가(아파트), 골프, 주식·부동산, 제네시스 자랑을 딱 한 스푼씩만 끼워 넣는다. (과하지 않게)',
    '',
    '[금지]',
    '- 모욕·혐오·성차별·인신공격·정치/종교/지역 차별 발언은 절대 금지.',
    '- 코믹하고 정겨운 "꼰대" 선을 넘지 마라. 사람을 진짜로 불쾌하게 만들면 안 된다.',
    '',
    '[해몽 자체는 진지하게]',
    '- 말투는 꼰대지만, 길몽/흉몽 판정과 현실 조언은 그럴듯하고 진지하게 한다.',
    '- 꿈의 상징을 한국 전통 해몽 느낌으로 해석하되, 현실적인 조언으로 마무리한다.',
    '',
    '[출력 형식 — 매우 중요]',
    '- 반드시 아래 JSON 객체 "하나만" 출력한다. 설명 문장, 마크다운, 코드블록 금지.',
    '{',
    '  "verdict": "길몽" 또는 "흉몽" 또는 "반길몽반흉몽" 중 하나의 문자열,',
    '  "score": 0부터 100 사이 정수 (길할수록 높게, 흉할수록 낮게),',
    '  "title": "한 줄 제목 문자열",',
    '  "interpretation": "김부장 말투의 해몽 본문 (2~4문장)",',
    '  "advice": "김부장 말투의 현실 조언 (1~3문장)",',
    '  "luckyItem": "행운의 아이템/키워드 (짧게)"',
    '}',
    '- verdict는 정확히 "길몽", "흉몽", "반길몽반흉몽" 셋 중 하나의 문자열이어야 한다. 다른 표현 금지.',
    '- interpretation과 advice에는 반드시 김부장 말투(반말/하대/거들먹거림)를 녹여라.',
  ].join('\n');
}

function buildUserPrompt(dream) {
  return [
    '다음은 사용자가 어젯밤에 꾼 꿈 내용이야. 김부장 캐릭터로 해몽해 줘.',
    '',
    '【꿈 내용】',
    dream,
    '',
    '위 꿈을 해몽해서, 앞서 지시한 스키마의 JSON 객체 하나로만 응답해.',
    'verdict는 반드시 "길몽" / "흉몽" / "반길몽반흉몽" 중 하나여야 하고,',
    'interpretation과 advice는 김부장 말투로 작성해.',
  ].join('\n');
}

// ------------------------------------------------------------
// 5. POST /api/interpret
//    입력 검증 → OpenAI 호출 → JSON 파싱/정규화 → 해몽 결과 반환.
// ------------------------------------------------------------
app.post('/api/interpret', async (req, res) => {
  // 키가 없으면 외부 호출 자체가 불가하므로 친절히 안내.
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      success: false,
      message:
        '서버에 OpenAI API 키가 설정되어 있지 않아요. .env의 openai_api_key 값을 확인해 주세요.',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // 1) 입력 검증
  if (typeof body.dream !== 'string' || body.dream.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: '꿈 내용을 입력해 주세요. 어젯밤 꾼 꿈을 적어 주시면 김부장이 봐드립니다.',
    });
  }

  const trimmedDream = body.dream.trim();
  if (trimmedDream.length < MIN_DREAM_LEN) {
    return res.status(400).json({
      success: false,
      message: '꿈 내용이 너무 짧아요. 조금만 더 자세히 적어 주세요.',
    });
  }

  // 너무 길면 안전하게 잘라서 처리 (에러 대신 컷)
  const dream = trimmedDream.slice(0, MAX_DREAM_LEN);

  // 2) OpenAI Chat Completions 호출
  const payload = {
    model: OPENAI_MODEL,
    // JSON 강제 출력으로 파싱 안정화
    response_format: { type: 'json_object' },
    temperature: 0.85, // 캐릭터성 살리되 너무 산만하지 않게
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(dream) },
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
        ? '해몽에 시간이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.'
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
      message: 'AI가 해몽을 하지 못했어요. 잠시 후 다시 시도해 주세요.',
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

  // content는 JSON 문자열 — 파싱해서 결과 객체를 꺼낸다.
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error('OpenAI content JSON.parse 실패:', content.slice(0, 500));
    return res.status(502).json({
      success: false,
      message: 'AI가 만든 해몽을 정리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  // 5) 계약 형태로 강제 정규화 (모델 출력을 그대로 믿지 않는다)
  const result = normalizeResult(parsed);

  // 정규화 후에도 핵심 본문이 비정상이면(이론상 거의 없음) 방어적으로 502.
  if (!result.interpretation) {
    console.error('정규화 후 유효한 해몽 본문이 없습니다:', content.slice(0, 500));
    return res.status(502).json({
      success: false,
      message: 'AI가 해몽을 제대로 만들지 못했어요. 꿈 내용을 조금 바꿔서 다시 시도해 주세요.',
    });
  }

  // 6) 성공 응답 (계약 형태 그대로)
  return res.json({
    success: true,
    result,
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
  console.log(`🌙 AI 꿈해몽 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  if (!OPENAI_API_KEY) {
    console.warn('⚠️  OpenAI API 키가 설정되지 않았습니다. .env의 openai_api_key를 확인하세요.');
  }
});

module.exports = app;
