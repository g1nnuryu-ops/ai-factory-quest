/************************************************************************
 * RAPA 증명서 발급 시스템 - Google Apps Script 웹앱 (서버리스 백엔드)
 * ---------------------------------------------------------------------
 *  역할
 *   1) doPost  : 증명서 발급 1건(또는 여러건)을 공유 시트에 '행 누적'
 *   2) doGet   : action=courses      (RAPA 운영 과정목록)
 *                action=coursedetail (과정 상세 _2: 일수/시간/사업명/담당자)
 *                action=roster       (수강생 명단 _4: 이름/생년월일/출결 — 기관전용)
 *                action=meta         (다음 증명서 번호/순서, 담당부서, 담당자 목록)
 *                action=ping         (상태 확인)
 *
 *  배포 방법 (시트 편집 권한 있는 계정으로)
 *   ① 대상 구글시트 열기 → 확장 프로그램 → Apps Script
 *   ② 이 파일 전체를 Code.gs 에 붙여넣기 → 저장
 *   ③ ⚙️ 프로젝트 설정 → 스크립트 속성에 SHEET_ID / HRD_AUTH_KEY 등록 (아래 참조)
 *      → 편집기에서 _check_config() 실행해 확인
 *   ④ 배포 → 새 배포 → 유형: '웹 앱'
 *        - 실행: '나'(본인)         - 액세스: '모든 사용자'
 *   ⑤ 생성된 웹앱 URL(https://script.google.com/macros/s/.../exec)을 복사
 *   ⑥ RAPA/config.js (gitignore 됨) 의 WEBAPP_URL 에 붙여넣기
 *
 *  ⚠️ 이 파일은 공개 저장소(ai-factory-quest)로 동기화된다. 키·시트ID·웹앱URL을
 *     이 파일에 직접 적지 말 것.
 ************************************************************************/

/* ===================== 비밀값 (스크립트 속성) =====================
 *  ⚠️ 아래 값들은 코드에 하드코딩하지 않는다. 이 파일은 공개 저장소로 동기화된다.
 *
 *  설정 방법 (최초 1회):
 *    Apps Script 편집기 → ⚙️ 프로젝트 설정 → 스크립트 속성 → 속성 추가
 *      SHEET_ID       = <발급대장 구글시트 ID>
 *      HRD_AUTH_KEY   = <HRD-Net 기관키>          (RAPA/.env 의 api_KEY 값)
 *      CUSTOM_API_KEY = <RAPA 내부 API 키>        (선택 — 안 쓰면 생략)
 *
 *  또는 편집기에서 _setup_props() 를 1회 실행(값 채워 넣은 뒤 실행하고 되돌릴 것).
 * ================================================================= */
function prop_(key, required) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v && required) {
    throw new Error(
      '스크립트 속성 "' + key + '" 이(가) 설정되지 않았습니다. ' +
      'Apps Script → 프로젝트 설정 → 스크립트 속성에서 추가하세요.'
    );
  }
  return v || '';
}
function sheetId_()      { return prop_('SHEET_ID', true); }
function hrdAuthKey_()   { return prop_('HRD_AUTH_KEY', true); }
function customApiKey_() { return prop_('CUSTOM_API_KEY', false); }

/* ===================== 설정 ===================== */
const SHEET_GID = 210882555;                 // 데이터가 쌓이는 탭(gid)
const DEPT_DEFAULT = 'AX·DX 교육센터';
const CERT_PREFIX  = 'RAPA26-AXDX-';         // 증명서 번호 접두사(마지막 행에서 자동 감지도 함)
const CERT_PAD     = 4;                       // 일련번호 자리수 (0337 → 4)

// 시트 헤더명(정확히 일치해야 함). 순서가 바뀌어도 이름으로 컬럼을 찾음.
const COL = {
  seq:    '수료순서',
  certNo: '증명서 번호',
  name:   '교육생 이름',
  birth:  '생년월일',
  type:   '증명서 종류',
  course: '교육과정명',
  dept:   '담당부서',
  manager:'담당자',
  planned:'2025년  진행중 ~ 진행예정  [교육과정명]'  // 큐레이션된 과정 목록 컬럼(있으면 사용)
};

/* ----- 교육과정 데이터 소스 -----
 *  'sheet'  : 시트의 교육과정명(이미 발급된 과정 + 진행예정 컬럼)에서 추출 (지금 바로 동작)
 *  'custom' : RAPA 내부/외부 API에서 가져옴 (CUSTOM_API_* 채우면 동작)
 *  'hrdnet' : 공개 HRD-Net work24 OpenAPI (해당 키가 '직업훈련' 서비스에 가입돼야 동작)
 */
//  'rapa'   : RAPA 운영 과정목록(아래 RAPA_COURSES) + _4 명단 자동조회(이름/생년월일)  ← 현재 사용
const COURSE_SOURCE = 'rapa';   // 'rapa' | 'hrdnet' | 'sheet' | 'custom'

// HRD-Net OpenAPI (hrd.work24.go.kr 구 JSP) — 2026-06 라이브 테스트로 동작 확인됨.
// 우리 키 = RAPA 기관 키 → _4(기관전용)로 자기 과정 수강생(이름/생년월일/출결) 조회 가능.
// ⚠️ 키는 하드코딩 금지. 스크립트 속성 HRD_AUTH_KEY 에서 읽는다 → hrdAuthKey_()
const HRD_BASE       = 'https://hrd.work24.go.kr/jsp/HRDP/HRDPO00/HRDPOA60';
const HRD_LIST_URL   = HRD_BASE + '/HRDPOA60_1.jsp';   // 훈련과정 목록(공개검색)
const HRD_DETAIL_URL = HRD_BASE + '/HRDPOA60_2.jsp';   // 훈련과정 상세(일수/시간/사업명/담당자)
const HRD_ROSTER_URL = HRD_BASE + '/HRDPOA60_4.jsp';   // 훈련생 명단(기관전용: 이름/생년월일/출결)

// RAPA 운영 과정목록 — Sheet1.xlsx(과정ID/회차/기간)에서 생성. 과정 변경 시 재생성(또는 시트탭으로 이전).
const RAPA_COURSES = [
  { id: "AIG20250000501522", degr: "5", name: "[네오위즈] Advanced K-Game Academy", startDate: "2025.12.08", endDate: "2026.08.05", status: "확정자신고확인" },
  { id: "AIG20250000501522", degr: "6", name: "[네오위즈] Advanced K-Game Academy", startDate: "2025.12.29", endDate: "2026.08.25", status: "확정자신고확인" },
  { id: "AIG20250000501522", degr: "7", name: "[네오위즈] Advanced K-Game Academy", startDate: "2026.02.09", endDate: "2026.10.07", status: "확정자신고확인" },
  { id: "AIG20250000501522", degr: "8", name: "[네오위즈] Advanced K-Game Academy", startDate: "2026.05.26", endDate: "2027.01.15", status: "확정자신고확인" },
  { id: "AIG20250000501522", degr: "9", name: "[네오위즈] Advanced K-Game Academy", startDate: "2026.06.15", endDate: "2027.02.04", status: "확정자신고확인" },
  { id: "AIG20250000501522", degr: "10", name: "[네오위즈] Advanced K-Game Academy", startDate: "2026.06.22", endDate: "2027.02.15", status: "실시신고확인" },
  { id: "AIG20250000501735", degr: "1", name: "WINS Cloud Security School", startDate: "2025.12.15", endDate: "2026.06.24", status: "확정자신고확인" },
  { id: "AIG20250000501735", degr: "2", name: "WINS Cloud Security School", startDate: "2026.06.29", endDate: "2026.12.23", status: "실시신고확인" },
  { id: "AIG20240000501208", degr: "3", name: "카카오테크 부트캠프 - 클라우드 네이티브 과정", startDate: "2026.05.12", endDate: "2026.11.17", status: "확정자신고확인" },
  { id: "AIG20240000501225", degr: "2", name: "초실감 영상 제작을 위한 DI & DIT 아카데미", startDate: "2026.01.19", endDate: "2026.06.26", status: "확정자신고확인" },
  { id: "AIG20240000501233", degr: "3", name: "Autodesk 제너레이티브 AI 디자인&3D프린팅 스쿨", startDate: "2026.06.17", endDate: "2026.12.22", status: "확정자신고확인" },
  { id: "AIG20240000501250", degr: "2", name: "AWS AI School", startDate: "2025.12.23", endDate: "2026.07.10", status: "확정자신고확인" },
  { id: "AIG20240000498211", degr: "3", name: "LIG D&A The SSEN 임베디드SW 스쿨", startDate: "2025.12.01", endDate: "2026.06.09", status: "결과보고확인" },
  { id: "AIG20240000498211", degr: "4", name: "LIG D&A The SSEN 임베디드SW 스쿨", startDate: "2026.05.22", endDate: "2026.11.27", status: "확정자신고확인" },
  { id: "AIG20240000459012", degr: "4", name: "시스코(CISCO) 보안 아카데미", startDate: "2025.12.22", endDate: "2026.06.23", status: "확정자신고확인" },
  { id: "AIG20240000459012", degr: "5", name: "시스코(CISCO) 보안 아카데미", startDate: "2026.06.22", endDate: "2026.12.18", status: "확정자신고" },
  { id: "AIG20240000459062", degr: "4", name: "융합_데이터사이언스와 저널리즘 아카데미", startDate: "2025.12.22", endDate: "2026.03.04", status: "결과보고확인" },
  { id: "AIG20240000459062", degr: "5", name: "융합_데이터사이언스와 저널리즘 아카데미", startDate: "2026.06.22", endDate: "2026.08.28", status: "확정자신고확인" },
  { id: "AIG20240000459109", degr: "3", name: "현대오토에버 클라우드 스쿨", startDate: "2025.12.18", endDate: "2026.06.29", status: "확정자신고확인" },
  { id: "AIG20240000459111", degr: "3", name: "현대오토에버 웹&앱 개발 스쿨", startDate: "2025.12.18", endDate: "2026.06.29", status: "확정자신고확인" },
  { id: "AIG20240000459114", degr: "3", name: "현대오토에버 스마트팩토리 스쿨", startDate: "2025.12.18", endDate: "2026.06.29", status: "확정자신고확인" },
  { id: "AIG20240000459115", degr: "3", name: "현대오토에버 IT 보안 스쿨", startDate: "2025.12.18", endDate: "2026.06.29", status: "확정자신고확인" },
  { id: "AIG20240000459118", degr: "4", name: "텔레칩스 차량용 반도체 임베디드 스쿨", startDate: "2026.02.25", endDate: "2026.08.28", status: "확정자신고확인" },
  { id: "AIG20240000459123", degr: "4", name: "카카오테크 부트캠프 - 생성형 인공지능(AI) 과정", startDate: "2026.05.12", endDate: "2026.11.17", status: "확정자신고확인" },
  { id: "AIG20240000459124", degr: "4", name: "카카오테크 부트캠프 - 풀스택 과정", startDate: "2026.05.12", endDate: "2026.11.17", status: "확정자신고확인" },
  { id: "AIG20240000459125", degr: "6", name: "(현대로템) K-방산 AI모델 개발과정", startDate: "2026.01.28", endDate: "2026.07.28", status: "확정자신고확인" },
  { id: "AIG20240000459125", degr: "7", name: "(현대로템) K-방산 AI모델 개발과정", startDate: "2026.04.08", endDate: "2026.10.08", status: "확정자신고확인" },
  { id: "AIG20240000459168", degr: "5", name: "인텔 인공지능 응용앱 크리에이터 양성과정", startDate: "2025.12.29", endDate: "2026.07.01", status: "확정자신고확인" },
  { id: "AIG20240000459168", degr: "6", name: "인텔 인공지능 응용앱 크리에이터 양성과정", startDate: "2025.12.29", endDate: "2026.06.25", status: "확정자신고확인" },
  { id: "AIG20240000459168", degr: "7", name: "인텔 인공지능 응용앱 크리에이터 양성과정", startDate: "2025.12.30", endDate: "2026.07.03", status: "확정자신고확인" },
];

// RAPA 내부/자체 API (엔드포인트 받으면 여기 채우기) — 과정/명단(개인정보 포함 가능)
// ⚠️ 키는 스크립트 속성 CUSTOM_API_KEY 에서 읽는다 → customApiKey_()
const CUSTOM_COURSES_URL   = '';   // 예: 'https://api.example.com/courses'
const CUSTOM_ROSTER_URL    = '';   // 예: 'https://api.example.com/courses/{courseId}/trainees'

/* ===================== 라우팅 ===================== */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || 'ping').toLowerCase();
  let payload;
  try {
    if (action === 'courses')           payload = { ok: true, courses: getCourses_(p) };
    else if (action === 'coursedetail') payload = { ok: true, course: hrdCourseDetail_(p) };
    else if (action === 'roster')       payload = { ok: true, roster: getRoster_(p) };
    else if (action === 'meta')         payload = { ok: true, ...getMeta_() };
    else                           payload = { ok: true, message: 'RAPA cert webapp alive', source: COURSE_SOURCE };
  } catch (err) {
    payload = { ok: false, error: String(err && err.message || err) };
  }
  return reply_(payload, p.callback);   // callback 있으면 JSONP
}

function doPost(e) {
  let payload;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);              // 동시 발급 시 순번 충돌 방지
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const rows = Array.isArray(body) ? body : [body];
    const sheet = getSheet_();
    const results = rows.map(function (r) { return appendCert_(sheet, r); });
    payload = { ok: true, results: results, certNo: results[0] && results[0].certNo, seq: results[0] && results[0].seq };
  } catch (err) {
    payload = { ok: false, error: String(err && err.message || err) };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
  return reply_(payload, e && e.parameter && e.parameter.callback);
}

/* ===================== 발급(행 추가) ===================== */
function appendCert_(sheet, r) {
  const info = headerInfo_(sheet);
  const map  = info.map;
  const slot = nextSlot_(sheet);                 // 이름이 빈 첫 예약행(없으면 새 행)
  const seq    = slot.seq;
  // 번호 확정(락 안에서 실행됨): 클라이언트가 보낸 번호가 아직 시트에 없으면 인정(수동 지정·재발급),
  // 이미 쓰였거나(=동시 발급 충돌) 비어 있으면 서버가 계산한 다음 번호를 사용 → 번호 중복 원천 차단.
  const wanted  = r.certNo ? String(r.certNo).trim() : '';
  const usedNos = colValues_(sheet, 'certNo')
    .map(function (v) { return String(v == null ? '' : v).trim(); })
    .filter(Boolean);
  const certNo = (wanted && usedNos.indexOf(wanted) < 0) ? wanted : slot.certNo;

  const cols = ['seq', 'certNo', 'name', 'birth', 'type', 'course', 'dept', 'manager']
    .map(function (k) { return map[k]; }).filter(Boolean);
  const maxCol = Math.max.apply(null, cols);
  const isExisting = slot.row <= sheet.getLastRow();
  // 기존 예약행이면 값 읽어 보존(번호/순서/타열) 후 cert 필드만 덮어씀
  const arr = isExisting ? sheet.getRange(slot.row, 1, 1, maxCol).getValues()[0] : new Array(maxCol).fill('');
  const set = function (key, val) { if (map[key]) arr[map[key] - 1] = (val == null ? '' : val); };
  set('seq', seq);
  set('certNo', certNo);
  set('name', r.name);
  set('birth', r.birth);
  set('type', r.type);
  set('course', r.courseName || r.course);
  set('dept', r.dept || DEPT_DEFAULT);
  set('manager', r.manager || '');
  if (isExisting) sheet.getRange(slot.row, 1, 1, maxCol).setValues([arr]);
  else sheet.appendRow(arr);
  return { seq: seq, certNo: certNo, row: slot.row };
}

/* ===================== meta ===================== */
function getMeta_() {
  const sheet = getSheet_();
  const slot = nextSlot_(sheet);
  return {
    nextSeq: slot.seq,
    nextCertNo: slot.certNo,
    dept: DEPT_DEFAULT,
    managers: distinctCol_(sheet, 'manager').filter(function (m) { return m && m !== '-' && !/^ㅇ+$/.test(m); })
  };
}

// 다음 발급 슬롯 = '교육생 이름'이 비어있는 첫 행(미리 번호만 채워둔 예약행을 채움). 없으면 새 행.
function nextSlot_(sheet) {
  const info  = headerInfo_(sheet);
  const names = colValues_(sheet, 'name');
  const seqs  = colValues_(sheet, 'seq');
  const nos   = colValues_(sheet, 'certNo');
  var lastFilled = -1;
  for (var i = 0; i < names.length; i++) {
    if (String(names[i] == null ? '' : names[i]).trim() !== '') lastFilled = i;
  }
  const t = lastFilled + 1;                       // 채울 슬롯(데이터 0-based)
  const row = info.dataStart + t;
  var seqVal = (t < seqs.length) ? String(seqs[t] == null ? '' : seqs[t]).trim() : '';
  var noVal  = (t < nos.length)  ? String(nos[t]  == null ? '' : nos[t]).trim()  : '';
  if (!noVal) {                                   // 예약 번호 없으면 직전 번호 +1
    var prevNo = (lastFilled >= 0 && lastFilled < nos.length) ? String(nos[lastFilled] || '').trim() : '';
    noVal = bumpCertNo_(prevNo || (CERT_PREFIX + '0000'));
  }
  if (!seqVal) {                                  // 예약 순서 없으면 직전 +1
    var prevSeq = (lastFilled >= 0 && lastFilled < seqs.length) ? parseInt(seqs[lastFilled], 10) : NaN;
    seqVal = isNaN(prevSeq) ? String(t) : String(prevSeq + 1);
  }
  return { row: row, seq: seqVal, certNo: noVal };
}

function bumpCertNo_(no) {
  const m = String(no).match(/^(.*?)(\d+)\s*$/);
  if (!m) return no;
  return m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0');
}

/* ===================== 교육과정 ===================== */
function getCourses_(p) {
  if (COURSE_SOURCE === 'rapa')   return rapaCourses_(p);
  if (COURSE_SOURCE === 'custom' && CUSTOM_COURSES_URL) return customCourses_(p);
  if (COURSE_SOURCE === 'hrdnet') {
    try { return hrdCourses_(p); }
    catch (err) { return sheetCourses_(); }   // HRD-Net 오류 시 시트 과정목록으로 대체
  }
  return sheetCourses_();   // 시트에서 추출
}

// RAPA 운영 과정목록(Sheet1.xlsx 기반). 일수/시간/사업명/담당자는 과정 선택 시 _2 상세로 보강.
function rapaCourses_(p) {
  var kw = p && p.keyword ? String(p.keyword).toLowerCase() : '';
  return RAPA_COURSES
    .filter(function (c) { return !kw || (c.name + ' ' + (c.degr || '')).toLowerCase().indexOf(kw) >= 0; })
    .map(function (c) {
      return {
        id: c.id, degr: String(c.degr || ''), name: c.name,
        businessName: c.businessName || '', partner: c.partner || '',
        startDate: c.startDate || '', endDate: c.endDate || '',
        days: '', hours: '', institution: '한국전파진흥협회',
        torgId: 'default', status: c.status || ''
      };
    });
}

// 시트에서 과정명 추출: 이미 발급된 '교육과정명' + '진행예정' 컬럼을 합쳐 중복 제거
function sheetCourses_() {
  const sheet = getSheet_();
  const names = distinctCol_(sheet, 'course')
    .concat(distinctCol_(sheet, 'planned'))
    .map(function (s) { return String(s).trim(); })
    .filter(function (s) { return s && !/센터$/.test(s) && s !== 'ㅇㅇㅇ'; });
  const uniq = Array.from(new Set(names));
  return uniq.map(function (n) {
    return { id: '', degr: '', name: n, businessName: '', partner: '', startDate: '', endDate: '', days: '', hours: '', institution: '' };
  });
}

// RAPA 내부/자체 API 연동 (엔드포인트 받으면 매핑만 맞추면 됨)
function customCourses_(p) {
  const url = CUSTOM_COURSES_URL + (CUSTOM_COURSES_URL.indexOf('?') >= 0 ? '&' : '?')
            + 'key=' + encodeURIComponent(customApiKey_())
            + (p.keyword ? '&keyword=' + encodeURIComponent(p.keyword) : '');
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText() || '{}');
  const list = data.courses || data.list || data.data || [];
  return list.map(function (c) {
    return {
      id: c.id || c.courseId || c.trprId || '',
      degr: c.degr || c.trprDegr || '',
      name: c.name || c.courseName || c.title || c.훈련과정명 || '',
      businessName: c.businessName || c.사업명 || '',
      partner: c.partner || c.파트너사 || '',
      startDate: c.startDate || c.traStartDate || '',
      endDate: c.endDate || c.traEndDate || '',
      days: c.days || c.훈련일수 || '',
      hours: c.hours || c.훈련시간 || '',
      institution: c.institution || c.subTitle || ''
    };
  });
}

// HRD-Net 훈련과정 검색(목록). p.keyword 로 과정명 검색.
function hrdCourses_(p) {
  const y = (new Date()).getFullYear();
  const params = {
    authKey: hrdAuthKey_(), returnType: 'JSON', outType: '1',
    pageNum: '1', pageSize: '50', sort: 'DESC', sortCol: '2',   // 훈련시작일 최신순
    srchTraStDt: (y - 2) + '0101', srchTraEndDt: (y + 1) + '1231'
  };
  if (p && p.keyword) params.srchTraProcessNm = p.keyword;
  const res = UrlFetchApp.fetch(HRD_LIST_URL + '?' + qs_(params), { muteHttpExceptions: true, followRedirects: true });
  const list = (parseHrd_(res.getContentText()).srchList) || [];
  return list.map(function (c) {
    return {
      id: c.trprId || '', degr: String(c.trprDegr || ''), name: c.title || '',
      businessName: '', partner: '',
      startDate: dot_(c.traStartDate), endDate: dot_(c.traEndDate),
      days: '', hours: '', institution: c.subTitle || '',
      torgId: c.trainstCstId || 'default'   // 상세조회용 훈련기관ID
    };
  });
}

// HRD-Net 훈련과정 상세 — 일수/시간/사업명/담당자 채움. (과정 선택 시 호출)
function hrdCourseDetail_(p) {
  const params = {
    authKey: hrdAuthKey_(), returnType: 'JSON', outType: '2',
    srchTrprId: p.trprId || p.id, srchTrprDegr: p.degr || p.trprDegr,
    srchTorgId: p.torgId || 'default'
  };
  const res = UrlFetchApp.fetch(HRD_DETAIL_URL + '?' + qs_(params), { muteHttpExceptions: true, followRedirects: true });
  const d = parseHrd_(res.getContentText());
  const base = d.inst_base_info || {}, det = d.inst_detail_info || {};
  return {
    id: base.trprId || params.srchTrprId, degr: String(base.trprDegr || params.srchTrprDegr),
    name: base.trprNm || '', institution: base.inoNm || '',
    days: String(det.totTraingDyct || base.trDcnt || ''),
    hours: String(det.totTraingTime || base.trtm || ''),
    businessName: det.govBusiNm || '', manager: base.trprChap || '',
    target: base.trprTargetNm || ''
  };
}

// HRD-Net 응답 파서: 성공은 {"returnJSON":"{...}"} 이중 래핑, 오류는 {error}/HTML/XML.
function parseHrd_(text) {
  var outer;
  try { outer = JSON.parse(text); }
  catch (e) {
    throw new Error('HRD-Net 오류 응답: ' + String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 150).trim());
  }
  if (outer.error) throw new Error('HRD-Net: ' + outer.error);
  return outer.returnJSON ? JSON.parse(outer.returnJSON) : outer;
}

function qs_(params) {
  return Object.keys(params).map(function (k) {
    return k + '=' + encodeURIComponent(params[k]);
  }).join('&');
}

function dot_(s) { return String(s || '').replace(/-/g, '.'); }   // 2026-05-12 → 2026.05.12

/* ===================== 교육생 명단 ===================== */
// 공개 HRD-Net에는 수강생 개인정보(이름/생년월일)가 없음 → 기본 빈 배열(앱에서 수기/붙여넣기).
// RAPA 내부 명단 API가 있으면 CUSTOM_ROSTER_URL 채우면 자동조회로 전환.
function getRoster_(p) {
  // 1순위: HRD-Net _4 (기관전용) — RAPA 운영 과정의 수강생 이름/생년월일/출결
  var trprId = p.trprId || p.courseId || p.id;
  var degr   = p.degr   || p.trprDegr;
  if (trprId && degr) {
    try {
      var r = hrdRoster_(trprId, degr, p.torgId || 'default');
      if (r && r.length) return r;
    } catch (err) { /* 폴백 진행 */ }
  }
  // 2순위: RAPA 내부 명단 API(있으면)
  if (CUSTOM_ROSTER_URL && (p.courseId || trprId)) {
    var url = CUSTOM_ROSTER_URL.replace('{courseId}', encodeURIComponent(p.courseId || trprId))
            + (CUSTOM_ROSTER_URL.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(customApiKey_());
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText() || '{}');
    var list = data.roster || data.trainees || data.list || data.data || [];
    return list.map(function (t) { return { name: t.name || t.훈련생명 || t.성명 || '', birth: t.birth || t.생년월일 || '' }; });
  }
  return [];
}

// HRD-Net _4: 훈련생 명단(기관전용). XML(trneList>trne_list) → [{name, birth, status, atend, absent}]
function hrdRoster_(trprId, degr, torgId) {
  var params = { authKey: hrdAuthKey_(), returnType: 'XML', outType: '2',
                 srchTrprId: trprId, srchTrprDegr: degr, srchTorgId: torgId || 'default' };
  var res = UrlFetchApp.fetch(HRD_ROSTER_URL + '?' + qs_(params), { muteHttpExceptions: true, followRedirects: true });
  var root = XmlService.parse(res.getContentText()).getRootElement();  // 오류시 <HRDNet><error> → trneList 없음 → []
  var listEl = root.getChild('trneList');
  var items = listEl ? listEl.getChildren('trne_list') : [];
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var nm = childText_(items[i], 'trneeCstmrNm');
    if (!nm) continue;
    out.push({
      name: nm,
      birth: fmtBirth_(childText_(items[i], 'lifyeaMd')),
      status: childText_(items[i], 'trneeSttusNm'),
      atend: childText_(items[i], 'atendCnt'),
      absent: childText_(items[i], 'absentCnt')
    });
  }
  return out;
}
function childText_(el, name) { var c = el.getChild(name); return c ? c.getText() : ''; }
function fmtBirth_(s) { s = String(s || '').replace(/[^0-9]/g, ''); return s.length === 8 ? s.slice(0,4) + '.' + s.slice(4,6) + '.' + s.slice(6,8) : s; }

/* ===================== 시트 유틸 ===================== */
function getSheet_() {
  const ss = SpreadsheetApp.openById(sheetId_());
  const sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === SHEET_GID) return sheets[i];
  }
  return sheets[0];
}

// 헤더가 1행이 아닐 수 있음(상단에 제목/빈행) → '수료순서'가 있는 행을 자동 탐지.
function headerInfo_(sheet) {
  const norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const scan = Math.min(Math.max(sheet.getLastRow(), 1), 20);
  const grid = sheet.getRange(1, 1, scan, lastCol).getValues();
  const seqName = norm(COL.seq);
  var headerRow = 0, idx = {};
  for (var r = 0; r < grid.length; r++) {
    var hit = false;
    for (var c = 0; c < grid[r].length; c++) { if (norm(grid[r][c]) === seqName) { hit = true; break; } }
    if (hit) { headerRow = r + 1; grid[r].forEach(function (h, i) { idx[norm(h)] = i + 1; }); break; }
  }
  if (!headerRow) { headerRow = 1; (grid[0] || []).forEach(function (h, i) { idx[norm(h)] = i + 1; }); }
  const map = {};
  Object.keys(COL).forEach(function (key) { map[key] = idx[norm(COL[key])] || null; });
  return { map: map, headerRow: headerRow, dataStart: headerRow + 1 };
}

function headerMap_(sheet) { return headerInfo_(sheet).map; }
function findCol_(sheet, key) { return headerInfo_(sheet).map[key]; }

// 헤더 다음 행부터 해당 컬럼 값 배열
function colValues_(sheet, key) {
  const info = headerInfo_(sheet);
  const col = info.map[key];
  const last = sheet.getLastRow();
  if (!col || last < info.dataStart) return [];
  return sheet.getRange(info.dataStart, col, last - info.dataStart + 1, 1)
              .getValues().map(function (r) { return r[0]; });
}

function distinctCol_(sheet, key) {
  const out = [], seen = {};
  colValues_(sheet, key).forEach(function (v) {
    const s = String(v == null ? '' : v).trim();
    if (s && !seen[s]) { seen[s] = true; out.push(s); }
  });
  return out;
}

function nextSeq_(sheet) {
  var max = -1;
  colValues_(sheet, 'seq').forEach(function (v) { const n = parseInt(v, 10); if (!isNaN(n) && n > max) max = n; });
  return max + 1;
}

function makeCertNo_(sheet, seq) {
  var prefix = CERT_PREFIX, width = CERT_PAD;
  const nos = colValues_(sheet, 'certNo').map(function (v) { return String(v || '').trim(); }).filter(Boolean);
  const lastNo = nos[nos.length - 1];
  const m = lastNo && lastNo.match(/^(.*?)(\d+)\s*$/);
  if (m) { prefix = m[1]; width = m[2].length; }
  return prefix + String(seq).padStart(width, '0');
}

/* ===================== 응답(JSON / JSONP) ===================== */
function reply_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== 최초 1회 설정 / 점검 ===================== */
// 스크립트 속성을 편집기에서 한 번에 넣고 싶을 때 사용.
// ⚠️ 값을 채워 실행한 뒤에는 반드시 다시 빈 문자열로 되돌리고 저장할 것 (코드에 키가 남지 않도록).
function _setup_props() {
  const values = {
    SHEET_ID:       '',   // 발급대장 구글시트 ID
    HRD_AUTH_KEY:   '',   // HRD-Net 기관키 (RAPA/.env 의 api_KEY)
    CUSTOM_API_KEY: ''    // 선택
  };
  const props = PropertiesService.getScriptProperties();
  Object.keys(values).forEach(function (k) {
    if (values[k]) props.setProperty(k, values[k]);
  });
  Logger.log('설정된 속성: ' + props.getKeys().join(', '));
}

// 배포 전 점검 — 필요한 속성이 다 있는지, 시트에 붙는지 확인.
function _check_config() {
  const missing = ['SHEET_ID', 'HRD_AUTH_KEY'].filter(function (k) {
    return !PropertiesService.getScriptProperties().getProperty(k);
  });
  if (missing.length) throw new Error('누락된 스크립트 속성: ' + missing.join(', '));
  Logger.log('OK — 시트: ' + getSheet_().getName() + ' / 다음 번호: ' + nextSlot_(getSheet_()).certNo);
}

/* ===================== (선택) 로컬 테스트용 ===================== */
function _test_meta()    { Logger.log(getMeta_()); }
function _test_courses() { Logger.log(getCourses_({})); }
