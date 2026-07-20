/* =====================================================================
 * 당근마켓 클론 — 프론트엔드 전체 (CDN React 18 + Babel standalone 7.26.4)
 * API 계약: SPEC.md (경로/필드명/타입 변경 금지)
 * 라우팅: hash 기반 (#/login, #/signup, #/, #/product/:id, #/new,
 *          #/edit/:id, #/chats, #/chat/:roomId, #/my)
 * ===================================================================== */

const { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } = React;

// ========================================
// 🔧 상수
// ========================================
const API_BASE = '/api';                 // 상대경로 — localhost 하드코딩 금지
const TOKEN_KEY = 'carrot_token';        // SPEC 2절

// SPEC 6절 — 프론트/백엔드 동일 카테고리
const CATEGORIES = [
  '디지털기기', '생활가전', '가구/인테리어', '유아동', '의류',
  '도서/티켓', '스포츠/레저', '취미/게임', '반려동물', '식물', '기타'
];

const RANGE_KM = [2, 4, 7, 12];          // SPEC 4절 — regionRange 1~4 → 반경(km)
const MAX_IMAGES = 3;            // 사용자 확정 요구사항 A — 최대 3장 (구 명세의 5장에서 변경)
const IMAGE_MAX_PX = 800;
const IMAGE_QUALITY = 0.7;

const STATUS_LABEL = { selling: '판매중', reserved: '예약중', sold: '거래완료' };
const SORT_OPTIONS = [
  { value: 'recent', label: '최신순' },
  { value: 'price_asc', label: '낮은 가격순' },
  { value: 'price_desc', label: '높은 가격순' }
];

// GPS 가 막힌 데스크톱에서 테스트할 수 있게 하는 폴백 좌표 (SPEC 4절)
const PRESET_COORDS = [
  { label: '강남역', lat: 37.4979, lng: 127.0276 },
  { label: '홍대입구', lat: 37.5572, lng: 126.9245 },
  { label: '잠실', lat: 37.5133, lng: 127.1000 },
  { label: '여의도', lat: 37.5216, lng: 126.9241 },
  { label: '성수동', lat: 37.5446, lng: 127.0559 },
  { label: '수원 영통', lat: 37.2469, lng: 127.0716 }
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ========================================
// 🧮 유틸
// ========================================
function toNum(v, fallback) {
  // Postgres NUMERIC 은 문자열로 오는 경우가 있어 항상 숫자로 정규화한다.
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}

function formatPrice(price) {
  const n = toNum(price, 0);
  if (n <= 0) return '나눔';
  return n.toLocaleString('ko-KR') + '원';
}

function formatNumber(n) {
  return toNum(n, 0).toLocaleString('ko-KR');
}

// SPEC 8절 — 상대시간 표기
function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + '분 전';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + '시간 전';
  const day = Math.floor(hr / 24);
  if (day === 1) return '어제';
  if (day < 7) return day + '일 전';
  if (day < 31) return Math.floor(day / 7) + '주 전';
  if (day < 365) return Math.floor(day / 30) + '개월 전';
  return Math.floor(day / 365) + '년 전';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}

// SPEC 4절 — 1km 미만은 "600m", 이상은 "2.4km"
function distanceText(meters) {
  const m = toNum(meters, 0);
  if (m < 1000) return Math.max(0, Math.round(m / 10) * 10) + 'm';
  return (m / 1000).toFixed(1) + 'km';
}

// 같은 동네 상품은 서버가 "0m" 를 준다(동 중심 좌표라 정상). 화면에 "0m"라고 쓰면 오류처럼
// 보이므로, 목록에서는 생략하고(동네 이름이 이미 있음) 상세에서는 "우리 동네"로 바꿔 쓴다.
function isSameNeighborhood(text) {
  return !!text && /^0(\.0)?\s*(m|km)$/i.test(String(text).trim());
}
function meaningfulDistance(text) {
  if (!text || isSameNeighborhood(text)) return '';
  return String(text).trim();
}

// 사용자가 "주변 동네"를 직접 고를 때 거리 표시용 (서버와 동일한 하버사인)
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cx() {
  const out = [];
  for (let i = 0; i < arguments.length; i++) {
    const a = arguments[i];
    if (a) out.push(a);
  }
  return out.join(' ');
}

// ========================================
// 🔐 토큰 저장소 + fetch 래퍼 (Bearer 주입 / 401 일괄 처리)
// ========================================
const tokenStore = {
  get() {
    try { return window.localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  },
  set(token) {
    try { window.localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* private mode */ }
  },
  clear() {
    try { window.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* noop */ }
  }
};

// 401 이 뜨면 토큰을 지우고 로그인으로 보낸다. 이때 붉은 에러 토스트까지
// 같이 뜨면 시끄러우므로, 호출부가 구분할 수 있게 전용 에러 타입을 쓴다.
function AuthError(message) {
  const err = new Error(message);
  err.name = 'AuthError';
  return err;
}

let unauthorizedHandler = null;
function setUnauthorizedHandler(fn) { unauthorizedHandler = fn; }

async function api(path, options) {
  const opts = options || {};
  const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
  const token = tokenStore.get();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const hasBody = opts.body !== undefined && opts.body !== null;
  if (hasBody) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined
    });
  } catch (e) {
    throw new Error('서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.');
  }

  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }

  if (res.status === 401) {
    tokenStore.clear();
    if (unauthorizedHandler) unauthorizedHandler();
    throw AuthError((json && json.message) || '로그인이 필요해요.');
  }
  if (!res.ok || !json || json.success === false) {
    throw new Error((json && json.message) || ('요청을 처리하지 못했어요. (' + res.status + ')'));
  }
  return json.data;
}

// ========================================
// 🔀 해시 라우터 (라이브러리 없이)
// ========================================
function currentPath() {
  let h = window.location.hash || '';
  h = h.replace(/^#/, '');
  const qi = h.indexOf('?');
  if (qi >= 0) h = h.slice(0, qi);
  if (!h) return '/';
  return h.charAt(0) === '/' ? h : '/' + h;
}

function navigate(to, replace) {
  const target = '#' + (to.charAt(0) === '/' ? to : '/' + to);
  if (window.location.hash === target) return;
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

function useHashPath() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

function matchRoute(pattern, path) {
  const pp = pattern.split('/').filter(Boolean);
  const ap = path.split('/').filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].charAt(0) === ':') {
      params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
    } else if (pp[i] !== ap[i]) {
      return null;
    }
  }
  return params;
}

// ========================================
// 🖼 이미지 리사이즈 (최대 800px · JPEG 0.7 → data-URI)
// ========================================
function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || file.type.indexOf('image/') !== 0) {
      reject(new Error('이미지 파일만 올릴 수 있어요.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 열 수 없어요.'));
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) throw new Error('이미지 크기를 알 수 없어요.');
          if (w > IMAGE_MAX_PX || h > IMAGE_MAX_PX) {
            const ratio = Math.min(IMAGE_MAX_PX / w, IMAGE_MAX_PX / h);
            w = Math.max(1, Math.round(w * ratio));
            h = Math.max(1, Math.round(h * ratio));
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';       // 투명 PNG → JPEG 시 검게 변하는 것 방지
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
        } catch (e) {
          reject(new Error('이미지를 변환하지 못했어요.'));
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ========================================
// 🔔 토스트
// ========================================
const ToastCtx = createContext(function () {});
function useToast() { return useContext(ToastCtx); }

function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const push = useCallback((message, type) => {
    if (!message) return;
    seq.current += 1;
    const id = seq.current;
    setItems(prev => prev.concat([{ id: id, message: String(message), type: type || 'info' }]));
    setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 3200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* 헤더/검색바를 가리지 않도록 하단 스낵바 위치 */}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[200] flex flex-col items-center gap-2 px-4">
        {items.map(t => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'toast-in w-full max-w-[420px] rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
              t.type === 'success' ? 'bg-carrot text-white' : 'bg-ink/95 text-white'
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ========================================
// 🎨 아이콘
// ========================================
function Icon({ children, size, className, fill, strokeWidth }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size || 24}
      height={size || 24}
      fill={fill || 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth || 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const IconBack = p => <Icon {...p}><path d="M15 19 8 12l7-7" /></Icon>;
const IconSearch = p => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></Icon>;
const IconHome = p => <Icon {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /></Icon>;
const IconChat = p => <Icon {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.2A8 8 0 1 1 21 12Z" /></Icon>;
const IconUser = p => <Icon {...p}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></Icon>;
const IconHeart = p => <Icon {...p}><path d="M12 20.2 4.7 13a4.6 4.6 0 0 1 6.5-6.5l.8.8.8-.8A4.6 4.6 0 1 1 19.3 13Z" /></Icon>;
const IconPlus = p => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
const IconMore = p => <Icon {...p}><circle cx="12" cy="5" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="19" r="1.4" fill="currentColor" /></Icon>;
const IconCamera = p => <Icon {...p}><path d="M4 8.5h3l1.4-2h7.2L17 8.5h3v10H4z" /><circle cx="12" cy="13" r="3.2" /></Icon>;
const IconPin = p => <Icon {...p}><path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></Icon>;
const IconSend = p => <Icon {...p}><path d="M4.5 12 20 4.5 15.5 20l-4-6.2z" /><path d="M4.5 12l7 1.8" /></Icon>;
const IconEye = p => <Icon {...p}><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.6" /></Icon>;
const IconClose = p => <Icon {...p}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
const IconChevron = p => <Icon {...p}><path d="m9 5 7 7-7 7" /></Icon>;
const IconRefresh = p => <Icon {...p}><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v4.5h-4.5" /></Icon>;
const IconArrowUp = p => <Icon {...p}><path d="M12 20V5" /><path d="m5.5 11.5 6.5-6.5 6.5 6.5" /></Icon>;
const IconCheck = p => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7" /></Icon>;
const IconTrash = p => <Icon {...p}><path d="M4.5 7h15" /><path d="M9.5 7V4.8h5V7" /><path d="M6.5 7l.9 12.2h9.2L17.5 7" /></Icon>;
const IconPencil = p => <Icon {...p}><path d="M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 17z" /></Icon>;

function Spinner({ size, className }) {
  const s = size || 20;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" className={cx('animate-spin', className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" opacity="0.22" fill="none" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ========================================
// 🎨 디자인 시스템 (프레젠테이션 전용 · 비즈니스 로직 없음)
// ========================================
function Button({ children, variant, size, loading, disabled, className, type, ...rest }) {
  const v = variant || 'primary';
  const s = size || 'md';
  const variants = {
    primary: 'bg-carrot text-white active:bg-carrot-dark disabled:bg-carrot/40',
    secondary: 'bg-carrot-light text-carrot active:bg-[#FFE7D6] disabled:opacity-50',
    outline: 'bg-white text-ink border border-cool-200 active:bg-cool-100 disabled:opacity-50',
    ghost: 'bg-transparent text-cool-700 active:bg-cool-100 disabled:opacity-50',
    danger: 'bg-[#F04452] text-white active:bg-[#D93B48] disabled:opacity-50',
    dark: 'bg-ink text-white active:bg-black disabled:opacity-50'
  };
  const sizes = {
    sm: 'h-9 px-3 text-[13px] rounded-lg gap-1',
    md: 'h-11 px-4 text-[15px] rounded-xl gap-1.5',
    lg: 'h-[52px] px-5 text-base rounded-xl gap-2'
  };
  return (
    <button
      type={type || 'button'}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center font-bold transition-colors select-none',
        'disabled:cursor-not-allowed',
        variants[v], sizes[s], className
      )}
      {...rest}
    >
      {loading ? <Spinner size={s === 'sm' ? 15 : 18} /> : null}
      {children}
    </button>
  );
}

function Field({ label, error, hint, required, children, htmlFor }) {
  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={htmlFor} className="block mb-1.5 text-[13px] font-bold text-cool-700">
          {label}{required ? <span className="text-carrot ml-0.5">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="mt-1.5 text-[12px] text-[#F04452] font-medium">{error}</p> : null}
      {!error && hint ? <p className="mt-1.5 text-[12px] text-cool">{hint}</p> : null}
    </div>
  );
}

function Input({ label, error, hint, required, className, id, ...rest }) {
  const autoId = useRef('in-' + Math.random().toString(36).slice(2, 8));
  const inputId = id || autoId.current;
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={inputId}>
      <input
        id={inputId}
        className={cx(
          'w-full h-12 px-3.5 rounded-xl bg-cool-100 text-[15px] text-ink placeholder:text-cool-400',
          'outline-none border transition-colors',
          error ? 'border-[#F04452] bg-[#FFF5F5]' : 'border-transparent focus:border-carrot focus:bg-white',
          'disabled:opacity-60',
          className
        )}
        {...rest}
      />
    </Field>
  );
}

function Textarea({ label, error, hint, required, className, id, ...rest }) {
  const autoId = useRef('ta-' + Math.random().toString(36).slice(2, 8));
  const taId = id || autoId.current;
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={taId}>
      <textarea
        id={taId}
        className={cx(
          'w-full px-3.5 py-3 rounded-xl bg-cool-100 text-[15px] leading-relaxed text-ink placeholder:text-cool-400',
          'outline-none border transition-colors',
          error ? 'border-[#F04452] bg-[#FFF5F5]' : 'border-transparent focus:border-carrot focus:bg-white',
          className
        )}
        {...rest}
      />
    </Field>
  );
}

function Badge({ children, tone, className }) {
  const tones = {
    selling: 'bg-cool-100 text-cool-700',
    reserved: 'bg-[#EAF4FF] text-[#2D7FF9]',
    sold: 'bg-cool-200 text-cool-700',
    carrot: 'bg-carrot-light text-carrot',
    dark: 'bg-ink text-white'
  };
  return (
    <span className={cx('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold', tones[tone || 'selling'], className)}>
      {children}
    </span>
  );
}

function Card({ children, className, ...rest }) {
  return <div className={cx('bg-white rounded-2xl border border-cool-100', className)} {...rest}>{children}</div>;
}

function Modal({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || '대화상자'}
        className="sheet-up relative w-full max-w-[480px] max-h-[86vh] flex flex-col bg-white rounded-t-2xl sm:rounded-2xl sm:mx-4"
      >
        <div className="flex-none flex items-center justify-between px-4 h-14 border-b border-cool-100">
          <h2 className="text-[16px] font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="w-9 h-9 grid place-items-center rounded-full text-cool-700 active:bg-cool-100">
            <IconClose size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <div className="flex-none px-4 py-3 border-t border-cool-100">{footer}</div> : null}
      </div>
    </div>
  );
}

function EmptyState({ emoji, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-16">
      <div className="text-[44px] leading-none mb-3">{emoji || '🥕'}</div>
      <p className="text-[15px] font-bold text-ink">{title}</p>
      {description ? <p className="mt-1.5 text-[13px] text-cool leading-relaxed">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-16">
      <div className="text-[40px] leading-none mb-3">😵</div>
      <p className="text-[15px] font-bold text-ink">불러오지 못했어요</p>
      <p className="mt-1.5 text-[13px] text-cool leading-relaxed">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="md" className="mt-5" onClick={onRetry}>
          <IconRefresh size={16} /> 다시 시도
        </Button>
      ) : null}
    </div>
  );
}

function ProductRowSkeleton() {
  return (
    <div className="flex gap-3 px-4 py-4 border-b border-cool-100">
      <div className="skel w-[100px] h-[100px] rounded-lg bg-cool-100 flex-none" />
      <div className="flex-1 pt-1 space-y-2">
        <div className="skel h-4 w-3/4 rounded bg-cool-100" />
        <div className="skel h-3 w-1/2 rounded bg-cool-100" />
        <div className="skel h-4 w-1/3 rounded bg-cool-100" />
      </div>
    </div>
  );
}

// 매너온도 — 당근 시그니처. 온도에 따라 색이 변하는 게이지 (SPEC 8절)
function mannerColor(t) {
  if (t < 20) return '#4B7BEC';
  if (t < 30) return '#2D9CDB';
  if (t < 36.5) return '#12B886';
  if (t < 42) return '#F2C037';
  if (t < 50) return '#FF6F0F';
  return '#F04452';
}
function mannerFace(t) {
  if (t < 20) return '🥶';
  if (t < 30) return '😐';
  if (t < 36.5) return '🙂';
  if (t < 42) return '😊';
  if (t < 50) return '😄';
  return '🔥';
}

function MannerTemp({ temp, size, showFace }) {
  const t = toNum(temp, 36.5);
  const color = mannerColor(t);
  const pct = Math.max(3, Math.min(100, (t / 99) * 100));
  const big = size === 'lg';
  return (
    <div className={big ? 'w-full' : 'w-[110px]'}>
      <div className="flex items-center justify-between mb-1">
        <span className={cx('font-bold tabular-nums', big ? 'text-[17px]' : 'text-[13px]')} style={{ color: color }}>
          {t.toFixed(1)}°C {showFace === false ? null : mannerFace(t)}
        </span>
        {big ? <span className="text-[12px] text-cool">매너온도</span> : null}
      </div>
      <div className={cx('w-full rounded-full bg-cool-200 overflow-hidden', big ? 'h-2' : 'h-1.5')}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: pct + '%', background: color }} />
      </div>
    </div>
  );
}

function Thumbnail({ src, alt, className, rounded }) {
  if (!src) {
    return (
      <div className={cx('grid place-items-center bg-cool-100 text-cool-400', rounded || 'rounded-lg', className)}>
        <IconCamera size={22} />
      </div>
    );
  }
  return <img src={src} alt={alt || ''} loading="lazy" className={cx('object-cover bg-cool-100', rounded || 'rounded-lg', className)} />;
}

// ========================================
// 🧩 공통 레이아웃
// ========================================
function PageHeader({ title, subtitle, onBack, right, sticky }) {
  return (
    <header className={cx('flex-none flex items-center gap-1 pl-1 pr-2 h-14 bg-white border-b border-cool-100', sticky)}>
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="뒤로가기" className="w-10 h-10 flex-none grid place-items-center rounded-full text-ink active:bg-cool-100">
          <IconBack size={22} />
        </button>
      ) : <div className="w-3 flex-none" />}
      <div className="flex-1 min-w-0">
        <h1 className="text-[17px] font-bold text-ink truncate">{title}</h1>
        {subtitle ? <p className="text-[11px] text-cool truncate">{subtitle}</p> : null}
      </div>
      <div className="flex-none flex items-center gap-0.5">{right}</div>
    </header>
  );
}

function BottomTab({ path, unread }) {
  const tabs = [
    { to: '/', label: '홈', Ico: IconHome, match: p => p === '/' },
    { to: '/chats', label: '채팅', Ico: IconChat, match: p => p.indexOf('/chat') === 0, badge: unread },
    { to: '/my', label: '나의당근', Ico: IconUser, match: p => p === '/my' }
  ];
  return (
    <nav className="flex-none flex items-stretch h-[58px] bg-white border-t border-cool-100" aria-label="주요 메뉴">
      {tabs.map(t => {
        const active = t.match(path);
        return (
          <button
            key={t.to}
            type="button"
            onClick={() => navigate(t.to)}
            aria-current={active ? 'page' : undefined}
            className={cx('flex-1 flex flex-col items-center justify-center gap-0.5 relative', active ? 'text-ink' : 'text-cool-400')}
          >
            <span className="relative">
              <t.Ico size={23} strokeWidth={active ? 2.3 : 1.8} />
              {t.badge ? (
                <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-carrot text-white text-[10px] font-bold">
                  {t.badge > 99 ? '99+' : t.badge}
                </span>
              ) : null}
            </span>
            <span className={cx('text-[10px]', active ? 'font-bold' : 'font-medium')}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function BootScreen({ label }) {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-white">
      <div className="text-[44px] leading-none">🥕</div>
      <div className="mt-4 text-carrot"><Spinner size={22} /></div>
      <p className="mt-3 text-[13px] text-cool">{label || '불러오는 중…'}</p>
    </div>
  );
}

// ========================================
// 📍 위치인증 (SPEC 4절 — 이 앱의 핵심)
//   GPS → 실패 시 좌표 직접 입력 폴백. 데스크톱에선 폴백이 기본 경로다.
// ========================================
function LocationVerifier({ intro, confirmLabel, submitting, onConfirm }) {
  const [phase, setPhase] = useState('idle');        // idle | locating | resolved
  const [gpsError, setGpsError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [origin, setOrigin] = useState(null);        // 사용자가 서 있는(또는 입력한) 좌표
  const [isManual, setIsManual] = useState(false);
  const [region, setRegion] = useState(null);        // 확정 대상 동네
  const [distM, setDistM] = useState(0);
  const [nearby, setNearby] = useState([]);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);

  const resolve = useCallback(async (lat, lng, manual) => {
    setResolving(true);
    setResolveError('');
    try {
      const data = await api('/location/resolve', { method: 'POST', body: { lat: lat, lng: lng } });
      if (!aliveRef.current) return;
      setOrigin({ lat: lat, lng: lng });
      setIsManual(!!manual);
      setRegion(data.region || null);
      setDistM(toNum(data.distanceM, 0));
      setNearby(Array.isArray(data.nearby) ? data.nearby : []);
      setPhase('resolved');
    } catch (e) {
      if (!aliveRef.current) return;
      setResolveError(e.message);
      setPhase('idle');
      setManualOpen(true);      // 서비스 지역 밖이면 다른 좌표를 시도할 수 있게 폴백을 연다
    } finally {
      if (aliveRef.current) setResolving(false);
    }
  }, []);

  const useGps = useCallback(() => {
    setGpsError('');
    setResolveError('');
    if (!navigator.geolocation) {
      setGpsError('이 브라우저는 위치 기능을 지원하지 않아요.');
      setManualOpen(true);
      return;
    }
    if (window.isSecureContext === false) {
      setGpsError('HTTPS(또는 localhost)가 아니라서 위치를 쓸 수 없어요.');
      setManualOpen(true);
      return;
    }
    setPhase('locating');
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (!aliveRef.current) return;
        resolve(pos.coords.latitude, pos.coords.longitude, false);
      },
      err => {
        if (!aliveRef.current) return;
        setPhase('idle');
        const code = err && err.code;
        let msg = '위치를 가져오지 못했어요.';
        if (code === 1) msg = '위치 권한이 거부됐어요. 브라우저 주소창의 위치 아이콘에서 허용해 주세요.';
        else if (code === 2) msg = '현재 위치를 확인할 수 없어요. (기기 GPS/네트워크 확인)';
        else if (code === 3) msg = '위치 확인이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.';
        setGpsError(msg + ' 아래에서 좌표를 직접 넣어 진행할 수 있어요.');
        setManualOpen(true);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  }, [resolve]);

  const submitManual = e => {
    if (e) e.preventDefault();
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (isNaN(lat) || lat < -90 || lat > 90) { setResolveError('위도는 -90 ~ 90 사이 숫자여야 해요.'); return; }
    if (isNaN(lng) || lng < -180 || lng > 180) { setResolveError('경도는 -180 ~ 180 사이 숫자여야 해요.'); return; }
    resolve(lat, lng, true);
  };

  const pickPreset = p => {
    setManualLat(String(p.lat));
    setManualLng(String(p.lng));
    resolve(p.lat, p.lng, true);
  };

  // 주변 동네로 바꾸면 그 동네 중심 좌표로 인증한다. 거리 표시는 원래 위치 기준으로 재계산.
  const pickNearby = r => {
    setRegion(r);
    if (origin) setDistM(haversineM(origin.lat, origin.lng, toNum(r.lat, 0), toNum(r.lng, 0)));
    else setDistM(0);
  };

  const reset = () => {
    setPhase('idle');
    setRegion(null);
    setNearby([]);
    setResolveError('');
  };

  const confirm = () => {
    if (!region) return;
    // 확정된 동네 중심 좌표를 보낸다 → 서버가 같은 동네로 해석한다.
    onConfirm({
      lat: toNum(region.lat, origin ? origin.lat : 0),
      lng: toNum(region.lng, origin ? origin.lng : 0),
      region: region,
      distanceM: distM
    });
  };

  if (phase === 'resolved' && region) {
    return (
      <div className="fade-up">
        <div className="rounded-2xl bg-carrot-light border border-carrot/20 px-5 py-6 text-center">
          <div className="w-14 h-14 mx-auto grid place-items-center rounded-full bg-carrot text-white">
            <IconPin size={28} />
          </div>
          <p className="mt-3 text-[13px] text-cool-700">이 동네가 맞나요?</p>
          <p className="mt-1 text-[22px] font-extrabold text-ink">{region.name}</p>
          <p className="mt-0.5 text-[13px] text-cool">{region.fullName}</p>
          <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-1.5">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white text-[12px] font-bold text-carrot">
              현재 위치에서 {distanceText(distM)}
            </span>
            {isManual ? (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white text-[12px] font-bold text-cool">
                테스트 좌표
              </span>
            ) : null}
          </div>
        </div>

        {nearby.length ? (
          <div className="mt-4">
            <p className="text-[12px] font-bold text-cool-700 mb-2">가까운 다른 동네</p>
            <div className="flex flex-wrap gap-1.5">
              {nearby.slice(0, 8).map(r => {
                const on = region && r.code === region.code;
                return (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => pickNearby(r)}
                    className={cx(
                      'px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors',
                      on ? 'bg-carrot text-white border-carrot' : 'bg-white text-cool-700 border-cool-200 active:bg-cool-100'
                    )}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-6 space-y-2">
          <Button size="lg" className="w-full" loading={submitting} onClick={confirm}>
            {confirmLabel || '이 동네로 설정'}
          </Button>
          <Button variant="ghost" size="md" className="w-full" disabled={submitting} onClick={reset}>
            다시 찾기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {intro ? <p className="text-[14px] text-cool-700 leading-relaxed mb-5">{intro}</p> : null}

      <div className="rounded-2xl border border-cool-200 px-5 py-7 text-center">
        <div className="w-14 h-14 mx-auto grid place-items-center rounded-full bg-carrot-light text-carrot">
          {phase === 'locating' ? <Spinner size={26} /> : <IconPin size={28} />}
        </div>
        <p className="mt-3 text-[15px] font-bold text-ink">
          {phase === 'locating' ? '현재 위치를 확인하는 중…' : 'GPS 로 우리 동네를 찾아요'}
        </p>
        <p className="mt-1 text-[12px] text-cool leading-relaxed">
          동네 인증을 해야 이웃들의 물건을 볼 수 있어요.
        </p>
        <Button
          size="lg"
          className="w-full mt-5"
          onClick={useGps}
          loading={phase === 'locating' || (resolving && !manualOpen)}
        >
          현재 위치로 인증하기
        </Button>
      </div>

      {gpsError ? (
        <div className="mt-3 rounded-xl bg-[#FFF5F5] border border-[#FFD9D9] px-3.5 py-3">
          <p className="text-[13px] text-[#D93B48] leading-relaxed">{gpsError}</p>
        </div>
      ) : null}
      {resolveError ? (
        <div className="mt-3 rounded-xl bg-[#FFF5F5] border border-[#FFD9D9] px-3.5 py-3">
          <p className="text-[13px] text-[#D93B48] leading-relaxed">{resolveError}</p>
        </div>
      ) : null}

      <div className="mt-4">
        {!manualOpen ? (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="w-full text-[13px] font-bold text-cool-700 underline underline-offset-4 py-2"
          >
            위치 권한이 막혀 있나요? 테스트용 좌표 직접 입력
          </button>
        ) : (
          <div className="rounded-2xl bg-cool-100 p-4">
            <div className="flex items-center gap-1.5">
              <Badge tone="dark">테스트용</Badge>
              <p className="text-[13px] font-bold text-ink">좌표 직접 입력</p>
            </div>
            <p className="mt-1.5 text-[12px] text-cool leading-relaxed">
              데스크톱 브라우저에서는 GPS 가 막히는 게 기본이에요. 아래 버튼으로 서울 주요 지점 좌표를 넣고 진행하세요.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {PRESET_COORDS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => pickPreset(p)}
                  disabled={resolving}
                  className="px-3 py-1.5 rounded-full bg-white border border-cool-200 text-[13px] font-medium text-cool-700 active:bg-cool-200 disabled:opacity-50"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <form onSubmit={submitManual} className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="위도"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder="37.4979"
                  value={manualLat}
                  onChange={e => setManualLat(e.target.value)}
                  className="h-11 bg-white no-spin"
                />
              </div>
              <div className="flex-1">
                <Input
                  label="경도"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder="127.0276"
                  value={manualLng}
                  onChange={e => setManualLng(e.target.value)}
                  className="h-11 bg-white no-spin"
                />
              </div>
              <Button type="submit" size="md" className="mb-0 flex-none" loading={resolving}>확인</Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// ========================================
// 🔑 로그인
// ========================================
function LoginPage({ onAuthed }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const submit = async e => {
    e.preventDefault();
    const errs = {};
    if (!EMAIL_RE.test(email.trim())) errs.email = '이메일 형식이 올바르지 않아요.';
    if (password.length < 6) errs.password = '비밀번호는 6자 이상이에요.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email: email.trim(), password: password } });
      tokenStore.set(data.token);
      onAuthed(data.user);
      navigate('/', true);
    } catch (err) {
      // 로그인 화면에서는 401(자격 오류)도 그대로 안내해야 한다.
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="px-6 pt-16 pb-10">
        <div className="text-[52px] leading-none">🥕</div>
        <h1 className="mt-4 text-[26px] font-extrabold text-ink leading-snug">
          우리 동네 중고 직거래<br />당근마켓
        </h1>
        <p className="mt-2 text-[14px] text-cool leading-relaxed">
          동네 이웃과 가깝고 따뜻한 거래를 시작해 보세요.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-3" noValidate>
          <Input
            id="login-email"
            label="이메일"
            type="email"
            autoComplete="email"
            placeholder="carrot@example.com"
            value={email}
            onChange={e => { setEmail(e.target.value); if (errors.email) setErrors({ ...errors, email: '' }); }}
            error={errors.email}
          />
          <Input
            id="login-password"
            label="비밀번호"
            type="password"
            autoComplete="current-password"
            placeholder="6자 이상"
            value={password}
            onChange={e => { setPassword(e.target.value); if (errors.password) setErrors({ ...errors, password: '' }); }}
            error={errors.password}
          />
          <Button type="submit" size="lg" className="w-full mt-2" loading={loading}>로그인</Button>
        </form>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex-1 h-px bg-cool-200" />
          <span className="text-[12px] text-cool">아직 회원이 아니신가요?</span>
          <div className="flex-1 h-px bg-cool-200" />
        </div>

        <Button variant="outline" size="lg" className="w-full mt-4" onClick={() => navigate('/signup')}>
          회원가입하기
        </Button>
      </div>
    </div>
  );
}

// ========================================
// 📝 회원가입 3단계 위저드 (① 입력 → ② 위치인증 → ③ 완료)
// ========================================
function StepDots({ step }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={'전체 3단계 중 ' + step + '단계'}>
      {[1, 2, 3].map(i => (
        <span
          key={i}
          className={cx('h-1.5 rounded-full transition-all', i === step ? 'w-5 bg-carrot' : i < step ? 'w-1.5 bg-carrot/40' : 'w-1.5 bg-cool-200')}
        />
      ))}
    </div>
  );
}

function SignupPage({ onAuthed }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ email: '', password: '', passwordConfirm: '', nickname: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);     // { user, region, distanceM }

  const setField = (key, value) => {
    setForm(prev => Object.assign({}, prev, { [key]: value }));
    if (errors[key]) setErrors(prev => Object.assign({}, prev, { [key]: '' }));
  };

  // ① 입력 검증 (서버도 검증하지만 왕복을 아낀다)
  const submitStep1 = e => {
    e.preventDefault();
    const errs = {};
    if (!EMAIL_RE.test(form.email.trim())) errs.email = '이메일 형식이 올바르지 않아요.';
    if (form.password.length < 6) errs.password = '비밀번호는 6자 이상 입력해 주세요.';
    if (form.passwordConfirm !== form.password) errs.passwordConfirm = '비밀번호가 서로 달라요.';
    const nick = form.nickname.trim();
    if (nick.length < 2 || nick.length > 12) errs.nickname = '닉네임은 2~12자로 입력해 주세요.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setStep(2);
  };

  // ② 위치인증 완료 → 실제 가입 요청. 여기를 통과해야만 ③ 으로 간다.
  const submitSignup = async payload => {
    setSubmitting(true);
    try {
      const data = await api('/auth/signup', {
        method: 'POST',
        body: {
          email: form.email.trim(),
          password: form.password,
          nickname: form.nickname.trim(),
          lat: payload.lat,
          lng: payload.lng
        }
      });
      tokenStore.set(data.token);
      setResult({ user: data.user, region: payload.region, distanceM: payload.distanceM });
      setStep(3);
    } catch (err) {
      toast(err.message, 'error');
      // 이메일 중복 등 ①단계 값이 문제면 되돌려 보낸다.
      if (/이메일|비밀번호|닉네임/.test(err.message)) {
        if (err.message.indexOf('이메일') >= 0) setErrors(prev => Object.assign({}, prev, { email: err.message }));
        setStep(1);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const finish = () => {
    if (!result) return;
    onAuthed(result.user);
    navigate('/', true);
  };

  const back = () => {
    if (step === 1) navigate('/login', true);
    else if (step === 2) setStep(1);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <PageHeader
        title={step === 1 ? '회원가입' : step === 2 ? '동네 인증' : '가입 완료'}
        onBack={step === 3 ? null : back}
        right={<div className="pr-2"><StepDots step={step} /></div>}
      />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        {step === 1 ? (
          <div className="fade-up">
            <h2 className="text-[21px] font-extrabold text-ink leading-snug">
              당근마켓에서 쓸<br />계정을 만들어요
            </h2>
            <p className="mt-2 text-[13px] text-cool">1단계 · 기본 정보</p>

            <form onSubmit={submitStep1} className="mt-6 space-y-3" noValidate>
              <Input
                id="signup-email"
                label="이메일" required type="email" autoComplete="email"
                placeholder="carrot@example.com"
                value={form.email}
                onChange={e => setField('email', e.target.value)}
                error={errors.email}
              />
              <Input
                id="signup-password"
                label="비밀번호" required type="password" autoComplete="new-password"
                placeholder="6자 이상"
                value={form.password}
                onChange={e => setField('password', e.target.value)}
                error={errors.password}
              />
              <Input
                id="signup-password-confirm"
                label="비밀번호 확인" required type="password" autoComplete="new-password"
                placeholder="한 번 더 입력"
                value={form.passwordConfirm}
                onChange={e => setField('passwordConfirm', e.target.value)}
                error={errors.passwordConfirm}
              />
              <Input
                id="signup-nickname"
                label="닉네임" required type="text" maxLength={12}
                placeholder="2~12자"
                value={form.nickname}
                onChange={e => setField('nickname', e.target.value)}
                error={errors.nickname}
                hint="이웃에게 보여지는 이름이에요."
              />
              <Button type="submit" size="lg" className="w-full mt-3">다음</Button>
            </form>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="fade-up">
            <h2 className="text-[21px] font-extrabold text-ink leading-snug">
              {form.nickname.trim() || '이웃'}님,<br />동네를 인증해 주세요
            </h2>
            <p className="mt-2 text-[13px] text-cool">2단계 · 위치 인증 (필수)</p>
            <div className="mt-6">
              <LocationVerifier
                intro="당근마켓은 동네 인증을 마친 이웃끼리만 거래해요. 인증하지 않으면 가입이 완료되지 않습니다."
                confirmLabel="이 동네로 가입하기"
                submitting={submitting}
                onConfirm={submitSignup}
              />
            </div>
          </div>
        ) : null}

        {step === 3 && result ? (
          <div className="fade-up text-center pt-8">
            <div className="text-[60px] leading-none">🎉</div>
            <h2 className="mt-4 text-[22px] font-extrabold text-ink">가입이 끝났어요!</h2>
            <p className="mt-2 text-[14px] text-cool leading-relaxed">
              <b className="text-ink">{result.user.nickname}</b>님, 환영해요.<br />
              이제 <b className="text-carrot">{result.user.regionName}</b> 이웃들의 물건을 둘러볼 수 있어요.
            </p>

            <Card className="mt-6 p-4 text-left">
              <dl className="space-y-2.5 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-cool flex-none">이메일</dt>
                  <dd className="text-ink font-medium truncate">{result.user.email}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-cool flex-none">닉네임</dt>
                  <dd className="text-ink font-medium">{result.user.nickname}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-cool flex-none">인증 동네</dt>
                  <dd className="text-ink font-medium text-right">{result.user.regionFullName}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-cool flex-none">매너온도</dt>
                  <dd className="text-ink font-medium">{toNum(result.user.mannerTemp, 36.5).toFixed(1)}°C</dd>
                </div>
              </dl>
            </Card>

            <Button size="lg" className="w-full mt-6" onClick={finish}>당근마켓 시작하기</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ========================================
// 🏠 홈 피드
// ========================================
function ProductRow({ product, onClick, onToggleLike }) {
  const p = product;
  const dist = meaningfulDistance(p.distanceText);
  return (
    <article
      className="flex gap-3 px-4 py-4 border-b border-cool-100 active:bg-cool-100/60 cursor-pointer"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick(); }}
    >
      <div className="relative flex-none">
        <Thumbnail src={p.thumbnail} alt={p.title} className="w-[100px] h-[100px]" />
        {p.status && p.status !== 'selling' ? (
          <div className="absolute inset-0 rounded-lg bg-black/45 grid place-items-center">
            <span className="text-white text-[12px] font-bold">{STATUS_LABEL[p.status]}</span>
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="text-[15px] text-ink leading-snug line-clamp-2">{p.title}</h3>
        <p className="mt-0.5 text-[12px] text-cool">
          {p.regionName}
          {dist ? <span> · {dist}</span> : null}
          <span> · {timeAgo(p.bumpedAt || p.createdAt)}</span>
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          {p.status === 'reserved' ? <Badge tone="reserved">예약중</Badge> : null}
          {p.status === 'sold' ? <Badge tone="sold">거래완료</Badge> : null}
          <span className="text-[15px] font-bold text-ink">{formatPrice(p.price)}</span>
        </div>

        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] text-cool">
            <span className="inline-flex items-center gap-0.5"><IconEye size={14} /> {formatNumber(p.viewCount)}</span>
            {toNum(p.chatCount, 0) > 0 ? (
              <span className="inline-flex items-center gap-0.5"><IconChat size={14} /> {formatNumber(p.chatCount)}</span>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={p.isLiked ? '찜 해제' : '찜하기'}
            aria-pressed={!!p.isLiked}
            onClick={e => { e.stopPropagation(); onToggleLike(p); }}
            className={cx('inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-bold active:bg-cool-100',
              p.isLiked ? 'text-carrot' : 'text-cool')}
          >
            <IconHeart size={16} fill={p.isLiked ? 'currentColor' : 'none'} />
            {toNum(p.likeCount, 0) > 0 ? formatNumber(p.likeCount) : null}
          </button>
        </div>
      </div>
    </article>
  );
}

function CategoryChips({ value, onChange }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto hide-scrollbar px-4 py-2.5 border-b border-cool-100">
      <button
        type="button"
        onClick={() => onChange('')}
        className={cx('flex-none px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors',
          !value ? 'bg-ink text-white border-ink' : 'bg-white text-cool-700 border-cool-200')}
      >
        전체
      </button>
      {CATEGORIES.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(value === c ? '' : c)}
          className={cx('flex-none px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors whitespace-nowrap',
            value === c ? 'bg-ink text-white border-ink' : 'bg-white text-cool-700 border-cool-200')}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

// 목록 로딩 로직 — 홈/판매내역/찜목록이 공유한다.
function useProductList(scope, filters) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const reqRef = useRef(0);

  const key = JSON.stringify(filters || {});

  const load = useCallback(async (pageNum, append) => {
    reqRef.current += 1;
    const myReq = reqRef.current;
    if (append) setLoadingMore(true); else { setLoading(true); setError(''); }

    const f = JSON.parse(key);
    const qs = new URLSearchParams();
    qs.set('scope', scope);
    qs.set('page', String(pageNum));
    qs.set('limit', '20');
    if (f.q) qs.set('q', f.q);
    if (f.category) qs.set('category', f.category);
    if (f.status) qs.set('status', f.status);
    if (f.sort) qs.set('sort', f.sort);

    try {
      const data = await api('/products?' + qs.toString());
      if (reqRef.current !== myReq) return;      // 오래된 응답 무시
      const list = Array.isArray(data.items) ? data.items : [];
      setItems(prev => append ? prev.concat(list) : list);
      setPage(toNum(data.page, pageNum));
      setHasMore(!!data.hasMore);
      setTotal(toNum(data.total, list.length));
    } catch (e) {
      if (reqRef.current !== myReq) return;
      if (e.name === 'AuthError') return;
      if (append) toast(e.message, 'error');
      else setError(e.message);
    } finally {
      if (reqRef.current === myReq) { setLoading(false); setLoadingMore(false); }
    }
  }, [scope, key, toast]);

  useEffect(() => { load(1, false); }, [load]);

  const loadMore = () => { if (!loadingMore && hasMore) load(page + 1, true); };
  const reload = () => load(1, false);

  // 낙관적 찜 토글 — 즉시 반영하고 실패하면 되돌린다.
  const toggleLike = async p => {
    const wasLiked = !!p.isLiked;
    const prevCount = toNum(p.likeCount, 0);
    const apply = (liked, count) => setItems(prev => prev.map(it =>
      it.id === p.id ? Object.assign({}, it, { isLiked: liked, likeCount: count }) : it));

    apply(!wasLiked, Math.max(0, prevCount + (wasLiked ? -1 : 1)));
    try {
      await api('/products/' + p.id + '/like', { method: wasLiked ? 'DELETE' : 'POST' });
    } catch (e) {
      apply(wasLiked, prevCount);
      if (e.name !== 'AuthError') toast(e.message, 'error');
    }
  };

  return { items, setItems, page, hasMore, total, loading, loadingMore, error, loadMore, reload, toggleLike };
}

function ProductListView({ list, emptyEmoji, emptyTitle, emptyDesc, emptyAction }) {
  if (list.loading) {
    return <div>{[0, 1, 2, 3, 4].map(i => <ProductRowSkeleton key={i} />)}</div>;
  }
  if (list.error) {
    return <ErrorState message={list.error} onRetry={list.reload} />;
  }
  if (!list.items.length) {
    return <EmptyState emoji={emptyEmoji} title={emptyTitle} description={emptyDesc} action={emptyAction} />;
  }
  return (
    <div>
      {list.items.map(p => (
        <ProductRow
          key={p.id}
          product={p}
          onClick={() => navigate('/product/' + p.id)}
          onToggleLike={list.toggleLike}
        />
      ))}
      {list.hasMore ? (
        <div className="px-4 py-5">
          <Button variant="outline" size="md" className="w-full" loading={list.loadingMore} onClick={list.loadMore}>
            더보기
          </Button>
        </div>
      ) : (
        <p className="py-7 text-center text-[12px] text-cool-400">모든 상품을 다 봤어요</p>
      )}
    </div>
  );
}

function HomePage({ user }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('recent');
  const [onlySelling, setOnlySelling] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const filters = useMemo(() => ({
    q: debouncedQ,
    category: category,
    sort: sort,
    status: onlySelling ? 'selling' : ''
  }), [debouncedQ, category, sort, onlySelling]);

  const list = useProductList('near', filters);
  const rangeKm = RANGE_KM[Math.max(0, Math.min(3, toNum(user.regionRange, 2) - 1))];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white relative">
      <header className="flex-none flex items-center gap-2 px-4 h-14 bg-white border-b border-cool-100">
        <button
          type="button"
          onClick={() => navigate('/my')}
          className="flex items-center gap-0.5 min-w-0 active:opacity-60"
          aria-label="내 동네 설정으로 이동"
        >
          <span className="text-[18px] font-extrabold text-ink truncate">{user.regionName}</span>
          <IconChevron size={18} className="text-ink rotate-90 flex-none" />
        </button>
        <span className="flex-none text-[11px] text-cool bg-cool-100 px-2 py-0.5 rounded-full">
          반경 {rangeKm}km
        </span>
        <div className="flex-1" />
      </header>

      <div className="flex-none px-4 py-2.5 border-b border-cool-100">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cool"><IconSearch size={19} /></span>
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={user.regionName + ' 근처에서 검색'}
            aria-label="상품 검색"
            className="w-full h-11 pl-10 pr-9 rounded-xl bg-cool-100 text-[14px] text-ink placeholder:text-cool-400 outline-none border border-transparent focus:border-carrot focus:bg-white"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="검색어 지우기"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-full bg-cool-400 text-white"
            >
              <IconClose size={13} strokeWidth={2.6} />
            </button>
          ) : null}
        </div>
      </div>

      <CategoryChips value={category} onChange={setCategory} />

      <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-cool-100">
        <span className="text-[12px] text-cool">
          {list.loading ? '불러오는 중…' : '상품 ' + formatNumber(list.total) + '개'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlySelling(v => !v)}
            aria-pressed={onlySelling}
            className={cx('px-2.5 py-1 rounded-full text-[12px] font-bold border',
              onlySelling ? 'bg-carrot-light text-carrot border-carrot/30' : 'bg-white text-cool border-cool-200')}
          >
            거래가능만
          </button>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            aria-label="정렬"
            className="text-[12px] font-bold text-cool-700 bg-transparent outline-none"
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ProductListView
          list={list}
          emptyEmoji="🥕"
          emptyTitle={debouncedQ || category ? '조건에 맞는 상품이 없어요' : '아직 동네에 올라온 상품이 없어요'}
          emptyDesc={debouncedQ || category
            ? '검색어나 카테고리를 바꿔보세요.'
            : '첫 번째 상품을 올려 이웃에게 알려주세요. 내 동네 범위를 넓히면 더 많은 상품이 보여요.'}
          emptyAction={<Button size="md" onClick={() => navigate('/new')}><IconPlus size={17} /> 상품 등록하기</Button>}
        />
      </div>

      <button
        type="button"
        onClick={() => navigate('/new')}
        aria-label="상품 등록"
        className="absolute right-4 bottom-4 pl-4 pr-5 py-3.5 rounded-full bg-carrot text-white font-bold text-[15px] shadow-lg shadow-carrot/30 flex items-center gap-1 active:bg-carrot-dark"
      >
        <IconPlus size={20} strokeWidth={2.4} /> 글쓰기
      </button>
    </div>
  );
}

// ========================================
// 📄 상품 상세
// ========================================
function ImageCarousel({ images, title }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef(null);
  const lockRef = useRef(0);      // 버튼으로 이동하는 동안 스크롤 이벤트가 되돌리지 않게
  const list = Array.isArray(images) && images.length ? images : [];

  const onScroll = () => {
    if (Date.now() < lockRef.current) return;
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    setIdx(Math.max(0, Math.min(list.length - 1, Math.round(el.scrollLeft / w))));
  };

  const goTo = next => {
    const clamped = Math.max(0, Math.min(list.length - 1, next));
    setIdx(clamped);
    lockRef.current = Date.now() + 600;
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth || 0;
    if (el.scrollTo) el.scrollTo({ left: w * clamped, behavior: 'smooth' });
    else el.scrollLeft = w * clamped;
  };

  if (!list.length) {
    return (
      <div className="w-full aspect-square bg-cool-100 grid place-items-center text-cool-400">
        <div className="text-center">
          <IconCamera size={34} className="mx-auto" />
          <p className="mt-2 text-[13px]">등록된 사진이 없어요</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={ref} onScroll={onScroll} className="flex w-full aspect-square overflow-x-auto snap-x snap-mandatory hide-scrollbar bg-cool-100">
        {list.map((src, i) => (
          <img key={i} src={src} alt={title + ' 사진 ' + (i + 1)} className="w-full h-full flex-none object-cover snap-center" />
        ))}
      </div>
      {list.length > 1 ? (
        <>
          {/* 좌우 넘김 버튼 */}
          <button
            type="button"
            aria-label="이전 사진"
            data-testid="carousel-prev"
            disabled={idx === 0}
            onClick={() => goTo(idx - 1)}
            className={cx(
              'absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-full',
              'bg-black/40 text-white backdrop-blur-sm transition-opacity active:bg-black/60',
              idx === 0 ? 'opacity-0 pointer-events-none' : 'opacity-100'
            )}
          >
            <IconBack size={20} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            aria-label="다음 사진"
            data-testid="carousel-next"
            disabled={idx === list.length - 1}
            onClick={() => goTo(idx + 1)}
            className={cx(
              'absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-full',
              'bg-black/40 text-white backdrop-blur-sm transition-opacity active:bg-black/60',
              idx === list.length - 1 ? 'opacity-0 pointer-events-none' : 'opacity-100'
            )}
          >
            <IconChevron size={20} strokeWidth={2.2} />
          </button>

          {/* 현재 위치 인디케이터 */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {list.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={i + 1 + '번째 사진 보기'}
                aria-current={i === idx ? 'true' : undefined}
                onClick={() => goTo(i)}
                className={cx('h-1.5 rounded-full transition-all', i === idx ? 'w-4 bg-white' : 'w-1.5 bg-white/50')}
              />
            ))}
          </div>
          <div
            data-testid="carousel-counter"
            className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/45 text-white text-[11px] font-bold"
          >
            {idx + 1}/{list.length}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ReviewModal({ open, onClose, productId, targetName, onDone }) {
  const toast = useToast();
  const [score, setScore] = useState(1);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const options = [
    { value: 1, emoji: '😄', label: '좋아요' },
    { value: 0, emoji: '😐', label: '보통이에요' },
    { value: -1, emoji: '😞', label: '아쉬워요' }
  ];

  const submit = async () => {
    setSaving(true);
    try {
      await api('/reviews', { method: 'POST', body: { productId: toNum(productId, 0), score: score, comment: comment.trim() } });
      toast('후기를 보냈어요. 매너온도에 반영됩니다.', 'success');
      onClose();
      if (onDone) onDone();
    } catch (e) {
      if (e.name !== 'AuthError') toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="거래 후기 보내기"
      footer={<Button size="lg" className="w-full" loading={saving} onClick={submit}>후기 보내기</Button>}
    >
      <p className="text-[14px] text-cool-700 leading-relaxed">
        {targetName ? <b className="text-ink">{targetName}</b> : '거래 상대'}님과의 거래는 어땠나요?<br />
        평가는 상대의 매너온도에 반영돼요.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            onClick={() => setScore(o.value)}
            className={cx('py-4 rounded-xl border text-center transition-colors',
              score === o.value ? 'border-carrot bg-carrot-light' : 'border-cool-200 bg-white')}
          >
            <div className="text-[26px] leading-none">{o.emoji}</div>
            <div className={cx('mt-1.5 text-[12px] font-bold', score === o.value ? 'text-carrot' : 'text-cool')}>{o.label}</div>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <Textarea
          label="한 줄 후기 (선택)"
          rows={3}
          maxLength={200}
          placeholder="따뜻한 거래 경험을 남겨주세요."
          value={comment}
          onChange={e => setComment(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function ProductDetailPage({ id, user }) {
  const toast = useToast();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [buyers, setBuyers] = useState([]);
  const [buyersLoading, setBuyersLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/products/' + id);
      setProduct(data.product);
    } catch (e) {
      if (e.name === 'AuthError') return;
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const patch = async (body, successMsg) => {
    setBusy('patch');
    try {
      const data = await api('/products/' + id, { method: 'PATCH', body: body });
      if (data && data.product) setProduct(data.product); else await load();
      if (successMsg) toast(successMsg, 'success');
      setMenuOpen(false);
    } catch (e) {
      if (e.name !== 'AuthError') toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!window.confirm('이 게시글을 삭제할까요? 되돌릴 수 없어요.')) return;
    setBusy('delete');
    try {
      await api('/products/' + id, { method: 'DELETE' });
      toast('게시글을 삭제했어요.', 'success');
      navigate('/', true);
    } catch (e) {
      if (e.name !== 'AuthError') toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const bump = async () => {
    setBusy('bump');
    try {
      await api('/products/' + id + '/bump', { method: 'POST' });
      toast('끌어올렸어요! 목록 맨 위로 올라가요.', 'success');
      setMenuOpen(false);
      await load();
    } catch (e) {
      if (e.name !== 'AuthError') toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  // 낙관적 찜 토글
  const toggleLike = async () => {
    if (!product) return;
    const wasLiked = !!product.isLiked;
    const prevCount = toNum(product.likeCount, 0);
    setProduct(p => Object.assign({}, p, { isLiked: !wasLiked, likeCount: Math.max(0, prevCount + (wasLiked ? -1 : 1)) }));
    try {
      await api('/products/' + id + '/like', { method: wasLiked ? 'DELETE' : 'POST' });
    } catch (e) {
      setProduct(p => Object.assign({}, p, { isLiked: wasLiked, likeCount: prevCount }));
      if (e.name !== 'AuthError') toast(e.message, 'error');
    }
  };

  const startChat = async () => {
    if (!product) return;
    if (product.myChatRoomId) { navigate('/chat/' + product.myChatRoomId); return; }
    setBusy('chat');
    try {
      const data = await api('/chats', { method: 'POST', body: { productId: toNum(id, 0) } });
      const room = data.room || data;
      if (room && room.id) navigate('/chat/' + room.id);
      else toast('채팅방을 열지 못했어요.', 'error');
    } catch (e) {
      if (e.name !== 'AuthError') toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  // 거래완료 — 구매자는 이 상품으로 열린 채팅방의 상대들 중에서 고른다.
  const openComplete = async () => {
    setCompleteOpen(true);
    setMenuOpen(false);
    setBuyersLoading(true);
    try {
      const data = await api('/chats');
      const rooms = (Array.isArray(data.items) ? data.items : [])
        .filter(r => r.product && String(r.product.id) === String(id));
      setBuyers(rooms.map(r => r.peer).filter(Boolean));
    } catch (e) {
      if (e.name !== 'AuthError') toast(e.message, 'error');
      setBuyers([]);
    } finally {
      setBuyersLoading(false);
    }
  };

  const completeWith = async buyer => {
    setBusy('complete');
    try {
      await api('/products/' + id + '/complete', { method: 'POST', body: { buyerId: toNum(buyer.id, 0) } });
      setCompleteOpen(false);
      toast('거래를 완료했어요!', 'success');
      await load();
      setReviewTarget(buyer.nickname || '');
      setReviewOpen(true);
    } catch (e) {
      if (e.name !== 'AuthError') toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        <PageHeader title="" onBack={() => history.back()} />
        <div className="flex-1 overflow-y-auto">
          <div className="skel w-full aspect-square bg-cool-100" />
          <div className="p-4 space-y-3">
            <div className="skel h-5 w-2/3 rounded bg-cool-100" />
            <div className="skel h-4 w-1/3 rounded bg-cool-100" />
            <div className="skel h-24 w-full rounded bg-cool-100" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        <PageHeader title="상품" onBack={() => navigate('/')} />
        <div className="flex-1 overflow-y-auto">
          <ErrorState message={error || '상품을 찾을 수 없어요.'} onRetry={load} />
          <div className="px-8">
            <Button variant="outline" size="md" className="w-full" onClick={() => navigate('/')}>홈으로 가기</Button>
          </div>
        </div>
      </div>
    );
  }

  const p = product;
  const seller = p.seller || {};
  const isMine = !!p.isMine;
  const canReview = p.status === 'sold' && (isMine || p.myChatRoomId);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <PageHeader
        title=""
        onBack={() => { if (window.history.length > 1) window.history.back(); else navigate('/'); }}
        right={isMine ? (
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="게시글 관리" className="w-10 h-10 grid place-items-center rounded-full text-ink active:bg-cool-100">
            <IconMore size={20} />
          </button>
        ) : null}
      />

      <div className="flex-1 overflow-y-auto pb-2">
        <ImageCarousel images={p.images} title={p.title} />

        {/* 판매자 */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-cool-100">
          <div className="w-10 h-10 flex-none rounded-full bg-cool-100 grid place-items-center text-cool-700 font-bold">
            {(seller.nickname || '?').slice(0, 1)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-ink truncate">{seller.nickname || '알 수 없음'}</p>
            <p className="text-[12px] text-cool">
              {seller.regionName || p.regionName}
              {toNum(seller.verifyCount, 0) > 0 ? <span> · 동네인증 {formatNumber(seller.verifyCount)}회</span> : null}
            </p>
          </div>
          <MannerTemp temp={seller.mannerTemp} />
        </div>

        {/* 본문 */}
        <div className="px-4 py-4">
          <div className="flex items-start gap-2">
            {p.status && p.status !== 'selling' ? <Badge tone={p.status} className="mt-1.5">{STATUS_LABEL[p.status]}</Badge> : null}
            <h1 className="flex-1 text-[19px] font-bold text-ink leading-snug">{p.title}</h1>
          </div>
          <p className="mt-1.5 text-[13px] text-cool">
            {p.category} · {timeAgo(p.bumpedAt || p.createdAt)}
            {p.bumpedAt && p.createdAt && p.bumpedAt !== p.createdAt ? <span className="text-carrot font-bold"> · 끌올</span> : null}
          </p>

          <p className="mt-3 text-[17px] font-extrabold text-ink">{formatPrice(p.price)}</p>

          <p className="mt-4 text-[15px] text-ink leading-[1.7] whitespace-pre-wrap">{p.description}</p>

          <p className="mt-5 text-[13px] text-cool">
            관심 {formatNumber(p.likeCount)} · 채팅 {formatNumber(p.chatCount)} · 조회 {formatNumber(p.viewCount)}
          </p>

          <div className="mt-3 inline-flex items-center gap-1 text-[13px] text-cool">
            <IconPin size={15} />
            {p.regionName}
            {isSameNeighborhood(p.distanceText)
              ? <span> · 우리 동네</span>
              : meaningfulDistance(p.distanceText)
                ? <span> · 내 위치에서 {meaningfulDistance(p.distanceText)}</span>
                : null}
          </div>
        </div>

        {isMine ? (
          <div className="px-4 pb-4 grid grid-cols-3 gap-2">
            <Button variant="outline" size="md" onClick={bump} loading={busy === 'bump'}>
              <IconArrowUp size={16} /> 끌올
            </Button>
            <Button variant="outline" size="md" onClick={() => navigate('/edit/' + p.id)}>
              <IconPencil size={16} /> 수정
            </Button>
            <Button variant="outline" size="md" onClick={openComplete} disabled={p.status === 'sold'}>
              <IconCheck size={16} /> 거래완료
            </Button>
          </div>
        ) : null}

        {canReview ? (
          <div className="px-4 pb-6">
            <Button variant="secondary" size="md" className="w-full" onClick={() => { setReviewTarget(isMine ? '' : (seller.nickname || '')); setReviewOpen(true); }}>
              거래 후기 보내기
            </Button>
          </div>
        ) : null}
      </div>

      {/* 하단 액션바 */}
      <div className="flex-none flex items-center gap-3 px-4 py-2.5 border-t border-cool-100 bg-white">
        <button
          type="button"
          onClick={toggleLike}
          aria-label={p.isLiked ? '찜 해제' : '찜하기'}
          aria-pressed={!!p.isLiked}
          className={cx('flex-none w-11 h-11 grid place-items-center rounded-xl border active:bg-cool-100',
            p.isLiked ? 'text-carrot border-carrot/40 bg-carrot-light' : 'text-cool border-cool-200')}
        >
          <IconHeart size={22} fill={p.isLiked ? 'currentColor' : 'none'} />
        </button>
        <div className="w-px h-7 bg-cool-200" />
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-extrabold text-ink truncate">{formatPrice(p.price)}</p>
          <p className="text-[11px] text-cool">관심 {formatNumber(p.likeCount)}</p>
        </div>
        {isMine ? (
          <Button size="md" variant="dark" className="flex-none px-5" onClick={() => navigate('/chats')}>
            채팅 목록
          </Button>
        ) : (
          <Button size="md" className="flex-none px-6" loading={busy === 'chat'} onClick={startChat}>
            {p.myChatRoomId ? '채팅 계속하기' : '채팅하기'}
          </Button>
        )}
      </div>

      {/* 내 글 관리 시트 */}
      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="게시글 관리">
        <div className="space-y-2">
          <p className="text-[12px] font-bold text-cool mb-1">거래 상태</p>
          <div className="grid grid-cols-3 gap-2">
            {['selling', 'reserved', 'sold'].map(s => (
              <button
                key={s}
                type="button"
                disabled={s === 'sold'}
                onClick={() => patch({ status: s }, '상태를 ' + STATUS_LABEL[s] + '으로 바꿨어요.')}
                className={cx('py-3 rounded-xl border text-[14px] font-bold transition-colors',
                  p.status === s ? 'border-carrot bg-carrot-light text-carrot' : 'border-cool-200 bg-white text-cool-700',
                  s === 'sold' ? 'opacity-40 cursor-not-allowed' : '')}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-cool">거래완료는 구매자를 지정해야 해서 아래 버튼으로 진행해요.</p>

          <div className="pt-3 space-y-2">
            <Button variant="outline" size="md" className="w-full" onClick={openComplete} disabled={p.status === 'sold'}>
              <IconCheck size={17} /> 거래완료 처리하기
            </Button>
            <Button variant="outline" size="md" className="w-full" onClick={bump} loading={busy === 'bump'}>
              <IconArrowUp size={17} /> 끌어올리기
            </Button>
            <Button variant="outline" size="md" className="w-full" onClick={() => { setMenuOpen(false); navigate('/edit/' + p.id); }}>
              <IconPencil size={17} /> 게시글 수정
            </Button>
            <Button variant="danger" size="md" className="w-full" onClick={remove} loading={busy === 'delete'}>
              <IconTrash size={17} /> 삭제하기
            </Button>
          </div>
        </div>
      </Modal>

      {/* 구매자 선택 */}
      <Modal open={completeOpen} onClose={() => setCompleteOpen(false)} title="누구와 거래했나요?">
        {buyersLoading ? (
          <div className="py-10 grid place-items-center text-carrot"><Spinner size={24} /></div>
        ) : !buyers.length ? (
          <EmptyState
            emoji="💬"
            title="채팅한 이웃이 없어요"
            description="거래완료는 이 상품으로 채팅한 이웃 중에서 선택할 수 있어요."
          />
        ) : (
          <div className="space-y-2">
            {buyers.map(b => (
              <button
                key={b.id}
                type="button"
                disabled={busy === 'complete'}
                onClick={() => completeWith(b)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-cool-200 active:bg-cool-100 disabled:opacity-50"
              >
                <div className="w-10 h-10 flex-none rounded-full bg-cool-100 grid place-items-center font-bold text-cool-700">
                  {(b.nickname || '?').slice(0, 1)}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[15px] font-bold text-ink truncate">{b.nickname}</p>
                  <p className="text-[12px] text-cool">매너온도 {toNum(b.mannerTemp, 36.5).toFixed(1)}°C</p>
                </div>
                <IconChevron size={18} className="text-cool-400 flex-none" />
              </button>
            ))}
          </div>
        )}
      </Modal>

      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        productId={id}
        targetName={reviewTarget}
        onDone={load}
      />
    </div>
  );
}

// ========================================
// ✍️ 상품 등록 / 수정
// ========================================
function ProductFormPage({ mode, id }) {
  const toast = useToast();
  const isEdit = mode === 'edit';
  const [images, setImages] = useState([]);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [priceText, setPriceText] = useState('');
  const [isFree, setIsFree] = useState(false);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState('');
  const fileRef = useRef(null);

  const loadProduct = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    setLoadError('');
    try {
      const data = await api('/products/' + id);
      const p = data.product;
      if (!p.isMine) { setLoadError('내가 올린 게시글만 수정할 수 있어요.'); return; }
      setImages(Array.isArray(p.images) ? p.images : []);
      setTitle(p.title || '');
      setCategory(p.category || '');
      const price = toNum(p.price, 0);
      setIsFree(price === 0);
      setPriceText(price === 0 ? '' : String(price));
      setDescription(p.description || '');
    } catch (e) {
      if (e.name === 'AuthError') return;
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [isEdit, id]);

  useEffect(() => { loadProduct(); }, [loadProduct]);

  const pickFiles = async e => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';         // 같은 파일 다시 고를 수 있게
    if (!files.length) return;

    const room = MAX_IMAGES - images.length;
    if (room <= 0) { toast('사진은 최대 ' + MAX_IMAGES + '장까지 올릴 수 있어요.', 'error'); return; }
    const targets = files.slice(0, room);
    if (files.length > room) toast('사진은 최대 ' + MAX_IMAGES + '장이라 ' + room + '장만 추가했어요.', 'error');

    setUploading(true);
    try {
      const results = [];
      for (const f of targets) {
        try {
          results.push(await resizeImageFile(f));      // 800px · JPEG 0.7 로 축소
        } catch (err) {
          toast(err.message, 'error');
        }
      }
      if (results.length) {
        setImages(prev => prev.concat(results).slice(0, MAX_IMAGES));
        setErrors(prev => Object.assign({}, prev, { images: '' }));
      }
    } finally {
      setUploading(false);
    }
  };

  const removeImage = i => setImages(prev => prev.filter((_, idx) => idx !== i));

  const onPriceChange = e => {
    const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
    setPriceText(digits);
    if (errors.price) setErrors(prev => Object.assign({}, prev, { price: '' }));
  };

  const submit = async e => {
    e.preventDefault();
    const errs = {};
    const t = title.trim();
    const d = description.trim();
    if (t.length < 1 || t.length > 60) errs.title = '제목은 1~60자로 입력해 주세요.';
    if (!category) errs.category = '카테고리를 선택해 주세요.';
    if (d.length < 1 || d.length > 2000) errs.description = '설명은 1~2000자로 입력해 주세요.';
    const price = isFree ? 0 : parseInt(priceText || '', 10);
    if (!isFree && (isNaN(price) || price < 0)) errs.price = '가격을 입력해 주세요. (나눔이면 나눔을 선택)';
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast('입력값을 확인해 주세요.', 'error');
      return;
    }

    const body = {
      title: t,
      description: d,
      price: isFree ? 0 : price,
      category: category,
      images: images
    };

    setSaving(true);
    try {
      if (isEdit) {
        await api('/products/' + id, { method: 'PATCH', body: body });
        toast('게시글을 수정했어요.', 'success');
        navigate('/product/' + id, true);
      } else {
        const data = await api('/products', { method: 'POST', body: body });
        toast('상품을 등록했어요!', 'success');
        const p = data.product || data;
        if (p && p.id) navigate('/product/' + p.id, true);
        else navigate('/', true);
      }
    } catch (err) {
      if (err.name !== 'AuthError') toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        <PageHeader title="게시글 수정" onBack={() => window.history.back()} />
        <BootScreen label="게시글을 불러오는 중…" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        <PageHeader title="게시글 수정" onBack={() => window.history.back()} />
        <div className="flex-1 overflow-y-auto">
          <ErrorState message={loadError} onRetry={loadProduct} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <PageHeader
        title={isEdit ? '게시글 수정' : '내 물건 팔기'}
        onBack={() => { if (window.history.length > 1) window.history.back(); else navigate('/'); }}
      />

      <form onSubmit={submit} className="flex-1 flex flex-col min-h-0" noValidate>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* 사진 */}
          <div>
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
              <button
                type="button"
                onClick={() => fileRef.current && fileRef.current.click()}
                disabled={uploading || images.length >= MAX_IMAGES}
                className="flex-none w-[76px] h-[76px] rounded-xl border border-cool-200 grid place-items-center text-cool disabled:opacity-50"
                aria-label="사진 추가"
              >
                {uploading ? <Spinner size={20} /> : (
                  <div className="text-center">
                    <IconCamera size={22} className="mx-auto" />
                    <span className="block mt-0.5 text-[11px] font-bold">
                      {images.length}/{MAX_IMAGES}
                    </span>
                  </div>
                )}
              </button>
              {images.map((src, i) => (
                <div key={i} className="relative flex-none">
                  <img src={src} alt={'첨부 사진 ' + (i + 1)} className="w-[76px] h-[76px] rounded-xl object-cover bg-cool-100" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label={'사진 ' + (i + 1) + ' 삭제'}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 grid place-items-center rounded-full bg-ink text-white"
                  >
                    <IconClose size={13} strokeWidth={2.6} />
                  </button>
                  {i === 0 ? (
                    <span className="absolute bottom-0 inset-x-0 py-0.5 text-center text-[10px] font-bold text-white bg-black/55 rounded-b-xl">
                      대표
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={pickFiles} className="hidden" />
            <p className="mt-2 text-[12px] text-cool">
              사진은 최대 {MAX_IMAGES}장, 자동으로 {IMAGE_MAX_PX}px · JPEG 로 줄여서 올려요.
            </p>
          </div>

          <Input
            id="form-title"
            label="제목" required maxLength={60}
            placeholder="상품명을 입력해 주세요"
            value={title}
            onChange={e => { setTitle(e.target.value); if (errors.title) setErrors(prev => Object.assign({}, prev, { title: '' })); }}
            error={errors.title}
          />

          <Field label="카테고리" required error={errors.category}>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setCategory(c); setErrors(prev => Object.assign({}, prev, { category: '' })); }}
                  className={cx('px-3 py-2 rounded-full text-[13px] font-medium border transition-colors',
                    category === c ? 'bg-carrot text-white border-carrot' : 'bg-white text-cool-700 border-cool-200')}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          <div>
            <Field label="가격" required error={errors.price}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsFree(v => !v)}
                  aria-pressed={isFree}
                  className={cx('flex-none px-4 rounded-xl text-[14px] font-bold border transition-colors',
                    isFree ? 'bg-carrot text-white border-carrot' : 'bg-white text-cool-700 border-cool-200')}
                >
                  나눔
                </button>
                <div className="flex-1 relative">
                  <input
                    id="form-price"
                    type="text"
                    inputMode="numeric"
                    disabled={isFree}
                    value={isFree ? '' : (priceText ? Number(priceText).toLocaleString('ko-KR') : '')}
                    onChange={onPriceChange}
                    placeholder={isFree ? '0원 (나눔)' : '가격을 입력해 주세요'}
                    className={cx(
                      'w-full h-12 pl-3.5 pr-9 rounded-xl bg-cool-100 text-[15px] text-ink placeholder:text-cool-400 outline-none border transition-colors',
                      errors.price ? 'border-[#F04452] bg-[#FFF5F5]' : 'border-transparent focus:border-carrot focus:bg-white',
                      isFree ? 'opacity-50' : ''
                    )}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] text-cool">원</span>
                </div>
              </div>
            </Field>
          </div>

          <Textarea
            id="form-description"
            label="자세한 설명" required rows={7} maxLength={2000}
            placeholder="상품 상태, 사용 기간, 거래 희망 장소 등을 적어주세요."
            value={description}
            onChange={e => { setDescription(e.target.value); if (errors.description) setErrors(prev => Object.assign({}, prev, { description: '' })); }}
            error={errors.description}
            hint={description.length + ' / 2000자'}
          />

          <div className="rounded-xl bg-cool-100 px-3.5 py-3">
            <p className="text-[12px] text-cool leading-relaxed">
              거래 위치는 내가 인증한 동네로 자동 설정돼요. 동네를 바꾸려면 나의당근에서 재인증해 주세요.
            </p>
          </div>
        </div>

        <div className="flex-none px-4 py-3 border-t border-cool-100">
          <Button type="submit" size="lg" className="w-full" loading={saving} disabled={uploading}>
            {isEdit ? '수정 완료' : '작성 완료'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ========================================
// 💬 채팅 목록 — #/chats 화면과 나의당근 '채팅' 탭이 함께 쓴다
//   렌더링을 복사하지 않고 useChatRooms + ChatRoomList 한 벌만 둔다.
// ========================================
function useChatRooms() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/chats');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      if (e.name === 'AuthError') return;
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 하단 탭바 뱃지와 같은 계산식 — 안 읽은 메시지 합계
  const unreadTotal = items.reduce((sum, r) => sum + toNum(r.unread, 0), 0);

  return { items, loading, error, reload: load, total: items.length, unreadTotal };
}

function ChatRoomRow({ room }) {
  const peer = room.peer || {};
  const product = room.product || {};
  const unread = toNum(room.unread, 0);
  return (
    <button
      type="button"
      onClick={() => navigate('/chat/' + room.id)}
      className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-cool-100 text-left active:bg-cool-100/60"
    >
      <div className="w-12 h-12 flex-none rounded-full bg-cool-100 grid place-items-center font-bold text-cool-700">
        {(peer.nickname || '?').slice(0, 1)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <p className="text-[15px] font-bold text-ink truncate">{peer.nickname || '알 수 없음'}</p>
          <span className="text-[11px] text-cool flex-none">{timeAgo(room.lastAt)}</span>
        </div>
        <p className={cx('mt-0.5 text-[13px] truncate', unread > 0 ? 'text-ink font-medium' : 'text-cool')}>
          {room.lastMessage || '대화를 시작해 보세요'}
        </p>
        <p className="mt-0.5 text-[11px] text-cool-400 truncate">{product.title}</p>
      </div>
      <div className="flex-none flex flex-col items-end gap-1">
        <Thumbnail src={product.thumbnail} alt={product.title} className="w-11 h-11" />
        {unread > 0 ? (
          <span
            data-testid="room-unread"
            className="min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-carrot text-white text-[10px] font-bold"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function ChatRoomList({ rooms }) {
  if (rooms.loading) {
    return (
      <div className="p-4 space-y-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex gap-3">
            <div className="skel w-12 h-12 rounded-full bg-cool-100 flex-none" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="skel h-4 w-1/3 rounded bg-cool-100" />
              <div className="skel h-3 w-2/3 rounded bg-cool-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (rooms.error) return <ErrorState message={rooms.error} onRetry={rooms.reload} />;
  if (!rooms.items.length) {
    return (
      <EmptyState
        emoji="💬"
        title="아직 채팅이 없어요"
        description="관심 있는 상품에서 '채팅하기'를 눌러 이웃과 대화를 시작해 보세요."
        action={<Button size="md" onClick={() => navigate('/')}>상품 보러가기</Button>}
      />
    );
  }
  return <div>{rooms.items.map(room => <ChatRoomRow key={room.id} room={room} />)}</div>;
}

function ChatsPage() {
  const rooms = useChatRooms();
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <PageHeader
        title="채팅"
        right={
          <button type="button" onClick={rooms.reload} aria-label="새로고침" className="w-10 h-10 grid place-items-center rounded-full text-cool-700 active:bg-cool-100">
            <IconRefresh size={19} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <ChatRoomList rooms={rooms} />
      </div>
    </div>
  );
}

// ========================================
// 💬 채팅방 (3초 폴링 · 이탈 시 clearInterval)
// ========================================
function ChatRoomPage({ roomId, user }) {
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [product, setProduct] = useState(null);
  const [peer, setPeer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const lastIdRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const fetchMessages = useCallback(async silent => {
    try {
      const data = await api('/chats/' + roomId + '/messages');
      if (!aliveRef.current) return;
      setMessages(Array.isArray(data.items) ? data.items : []);
      setProduct(data.product || null);
      setPeer(data.peer || null);
      setError('');
    } catch (e) {
      if (!aliveRef.current) return;
      if (e.name === 'AuthError') return;
      if (!silent) setError(e.message);          // 폴링 실패는 조용히 넘긴다
    } finally {
      if (aliveRef.current && !silent) setLoading(false);
    }
  }, [roomId]);

  // 3초 폴링 — 라우트를 떠나면 반드시 정리한다.
  useEffect(() => {
    setLoading(true);
    lastIdRef.current = 0;
    fetchMessages(false);
    const timer = setInterval(() => fetchMessages(true), 3000);
    return () => clearInterval(timer);
  }, [fetchMessages]);

  // 새 메시지가 오면 아래로 스크롤 (사용자가 위를 읽는 중이면 방해하지 않음)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !messages.length) return;
    const last = messages[messages.length - 1];
    const lastId = last ? last.id : 0;
    if (lastId === lastIdRef.current) return;
    const first = lastIdRef.current === 0;
    lastIdRef.current = lastId;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180;
    if (first || nearBottom || (last && last.isMine)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const send = async e => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    if (body.length > 1000) { toast('메시지는 1000자까지 보낼 수 있어요.', 'error'); return; }
    setSending(true);
    try {
      const data = await api('/chats/' + roomId + '/messages', { method: 'POST', body: { body: body } });
      setText('');
      if (data && data.message) {
        const msg = Object.assign({}, data.message, { isMine: true });
        setMessages(prev => prev.concat([msg]));
      } else {
        await fetchMessages(true);
      }
    } catch (err) {
      if (err.name !== 'AuthError') toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const back = () => { if (window.history.length > 1) window.history.back(); else navigate('/chats'); };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        <PageHeader title="채팅" onBack={back} />
        <BootScreen label="대화를 불러오는 중…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        <PageHeader title="채팅" onBack={back} />
        <div className="flex-1 overflow-y-auto">
          <ErrorState message={error} onRetry={() => { setLoading(true); fetchMessages(false); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#F7F8F9]">
      <PageHeader
        title={peer ? peer.nickname : '채팅'}
        subtitle={peer ? '매너온도 ' + toNum(peer.mannerTemp, 36.5).toFixed(1) + '°C' : ''}
        onBack={back}
      />

      {product ? (
        <button
          type="button"
          onClick={() => navigate('/product/' + product.id)}
          className="flex-none flex items-center gap-3 px-4 py-2.5 bg-white border-b border-cool-100 text-left active:bg-cool-100/60"
        >
          <Thumbnail src={product.thumbnail} alt={product.title} className="w-11 h-11 flex-none" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {product.status && product.status !== 'selling' ? <Badge tone={product.status}>{STATUS_LABEL[product.status]}</Badge> : null}
              <p className="text-[13px] text-ink truncate">{product.title}</p>
            </div>
            <p className="text-[13px] font-bold text-ink">{formatPrice(product.price)}</p>
          </div>
          <IconChevron size={18} className="text-cool-400 flex-none" />
        </button>
      ) : null}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {!messages.length ? (
          <div className="h-full grid place-items-center">
            <div className="text-center px-8">
              <div className="text-[38px]">👋</div>
              <p className="mt-3 text-[14px] font-bold text-ink">대화를 시작해 보세요</p>
              <p className="mt-1 text-[13px] text-cool leading-relaxed">
                따뜻한 인사와 함께 거래를 시작하면 훨씬 수월해요.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {messages.map(m => (
              <div key={m.id} className={cx('flex', m.isMine ? 'justify-end' : 'justify-start')}>
                <div className={cx('flex items-end gap-1.5 max-w-[78%]', m.isMine ? 'flex-row-reverse' : '')}>
                  <div
                    className={cx('px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap',
                      m.isMine
                        ? 'bg-carrot text-white rounded-2xl rounded-br-md'
                        : 'bg-white text-ink rounded-2xl rounded-bl-md border border-cool-100')}
                  >
                    {m.body}
                  </div>
                  <span className="flex-none text-[10px] text-cool-400 pb-0.5">{timeAgo(m.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={send} className="flex-none flex items-end gap-2 px-3 py-2.5 bg-white border-t border-cool-100">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
          }}
          rows={1}
          maxLength={1000}
          placeholder="메시지를 입력하세요"
          aria-label="메시지 입력"
          className="flex-1 max-h-24 px-3.5 py-2.5 rounded-2xl bg-cool-100 text-[14px] text-ink placeholder:text-cool-400 outline-none border border-transparent focus:border-carrot focus:bg-white"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          aria-label="전송"
          className={cx('flex-none w-11 h-11 grid place-items-center rounded-full transition-colors',
            !text.trim() || sending ? 'bg-cool-200 text-white' : 'bg-carrot text-white active:bg-carrot-dark')}
        >
          {sending ? <Spinner size={18} /> : <IconSend size={20} />}
        </button>
      </form>
    </div>
  );
}

// ========================================
// 👤 나의 당근
// ========================================
function MyPage({ user, onUser, onLogout }) {
  const toast = useToast();
  const [tab, setTab] = useState('mine');
  const [nickOpen, setNickOpen] = useState(false);
  const [nickname, setNickname] = useState(user.nickname || '');
  const [nickError, setNickError] = useState('');
  const [savingNick, setSavingNick] = useState(false);
  const [range, setRange] = useState(toNum(user.regionRange, 2));
  const [regionOpen, setRegionOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const filters = useMemo(() => ({}), []);
  const mineList = useProductList('mine', filters);
  const likedList = useProductList('liked', filters);
  const chatRooms = useChatRooms();                 // #/chats 와 같은 훅을 재사용
  const list = tab === 'mine' ? mineList : likedList;

  // 슬라이더는 잠깐 멈췄을 때만 저장한다 (드래그 중 매번 호출 방지)
  useEffect(() => {
    const current = toNum(user.regionRange, 2);
    if (range === current) return;
    const timer = setTimeout(async () => {
      try {
        const data = await api('/me', { method: 'PATCH', body: { regionRange: range } });
        onUser(data.user);
        toast('내 동네 범위를 ' + RANGE_KM[range - 1] + 'km 로 바꿨어요.', 'success');
      } catch (e) {
        setRange(current);
        if (e.name !== 'AuthError') toast(e.message, 'error');
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [range]);

  const saveNickname = async () => {
    const nick = nickname.trim();
    if (nick.length < 2 || nick.length > 12) { setNickError('닉네임은 2~12자로 입력해 주세요.'); return; }
    setSavingNick(true);
    try {
      const data = await api('/me', { method: 'PATCH', body: { nickname: nick } });
      onUser(data.user);
      setNickOpen(false);
      toast('닉네임을 바꿨어요.', 'success');
    } catch (e) {
      if (e.name !== 'AuthError') setNickError(e.message);
    } finally {
      setSavingNick(false);
    }
  };

  const verifyLocation = async payload => {
    setVerifying(true);
    try {
      const data = await api('/me/verify-location', { method: 'POST', body: { lat: payload.lat, lng: payload.lng } });
      onUser(data.user);
      setRegionOpen(false);
      toast(data.user.regionName + ' 인증을 마쳤어요.', 'success');
      mineList.reload();
    } catch (e) {
      if (e.name !== 'AuthError') toast(e.message, 'error');
    } finally {
      setVerifying(false);
    }
  };

  const logout = () => {
    if (!window.confirm('로그아웃할까요?')) return;
    tokenStore.clear();
    onLogout();
    navigate('/login', true);
  };

  const temp = toNum(user.mannerTemp, 36.5);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <PageHeader title="나의 당근" />

      <div className="flex-1 overflow-y-auto">
        {/* 프로필 */}
        <div className="px-4 py-5">
          <div className="flex items-center gap-3.5">
            <div className="w-16 h-16 flex-none rounded-2xl bg-carrot-light grid place-items-center text-[24px] font-extrabold text-carrot">
              {(user.nickname || '?').slice(0, 1)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[19px] font-extrabold text-ink truncate">{user.nickname}</p>
                <button
                  type="button"
                  onClick={() => { setNickname(user.nickname || ''); setNickError(''); setNickOpen(true); }}
                  aria-label="닉네임 수정"
                  className="w-7 h-7 grid place-items-center rounded-full text-cool active:bg-cool-100"
                >
                  <IconPencil size={15} />
                </button>
              </div>
              <p className="text-[13px] text-cool truncate">{user.email}</p>
              <p className="mt-0.5 text-[12px] text-cool-400">{formatDate(user.createdAt)} 가입</p>
            </div>
          </div>

          <Card className="mt-4 p-4">
            <MannerTemp temp={temp} size="lg" />
            <p className="mt-2 text-[12px] text-cool leading-relaxed">
              {temp >= 36.5
                ? '따뜻한 거래를 하고 계시네요. 후기가 쌓이면 온도가 더 올라가요.'
                : '거래 후기를 받으면 매너온도가 올라가요.'}
            </p>
          </Card>
        </div>

        {/* 내 동네 */}
        <div className="px-4 pb-5">
          <h2 className="text-[15px] font-bold text-ink mb-2.5">내 동네</h2>
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 flex-none rounded-full bg-carrot-light text-carrot grid place-items-center">
                <IconPin size={19} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold text-ink truncate">{user.regionFullName}</p>
                <p className="text-[12px] text-cool">
                  인증 {formatNumber(user.verifyCount)}회
                  {user.regionVerifiedAt ? <span> · {timeAgo(user.regionVerifiedAt)} 인증</span> : null}
                </p>
              </div>
              <Button variant="outline" size="sm" className="flex-none" onClick={() => setRegionOpen(true)}>
                재인증
              </Button>
            </div>

            <div className="mt-5">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-[13px] font-bold text-cool-700">내 동네 범위</span>
                <span className="text-[13px] font-bold text-carrot">반경 {RANGE_KM[range - 1]}km</span>
              </div>
              <input
                type="range"
                min="1" max="4" step="1"
                value={range}
                onChange={e => setRange(parseInt(e.target.value, 10))}
                className="carrot-range"
                aria-label="내 동네 범위"
              />
              <div className="flex justify-between mt-1.5 px-0.5">
                {RANGE_KM.map((km, i) => (
                  <span key={km} className={cx('text-[11px]', range === i + 1 ? 'text-carrot font-bold' : 'text-cool-400')}>
                    {km}km
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-cool">범위를 넓히면 더 먼 동네의 상품까지 보여요.</p>
            </div>
          </Card>
        </div>

        {/* 판매내역 / 찜한 상품 / 채팅 */}
        <div className="border-t border-cool-100">
          <div className="flex">
            {[
              { key: 'mine', label: '판매내역', count: mineList.total },
              { key: 'liked', label: '찜한 상품', count: likedList.total },
              { key: 'chats', label: '채팅', count: chatRooms.total, badge: chatRooms.unreadTotal }
            ].map(t => (
              <button
                key={t.key}
                type="button"
                data-testid={'my-tab-' + t.key}
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? 'page' : undefined}
                className={cx('flex-1 py-3.5 text-[14px] font-bold border-b-2 transition-colors relative',
                  tab === t.key ? 'text-ink border-ink' : 'text-cool-400 border-transparent')}
              >
                {t.label}
                {t.count ? <span className="ml-1 text-carrot">{formatNumber(t.count)}</span> : null}
                {t.badge ? (
                  <span className="absolute top-2.5 right-3 w-1.5 h-1.5 rounded-full bg-carrot" aria-label="읽지 않은 메시지 있음" />
                ) : null}
              </button>
            ))}
          </div>

          {tab === 'chats' ? (
            <ChatRoomList rooms={chatRooms} />
          ) : (
            <ProductListView
              list={list}
              emptyEmoji={tab === 'mine' ? '📦' : '🧡'}
              emptyTitle={tab === 'mine' ? '아직 등록한 상품이 없어요' : '찜한 상품이 없어요'}
              emptyDesc={tab === 'mine' ? '안 쓰는 물건을 이웃에게 나눠보세요.' : '마음에 드는 상품에 하트를 눌러보세요.'}
              emptyAction={
                tab === 'mine'
                  ? <Button size="md" onClick={() => navigate('/new')}><IconPlus size={17} /> 상품 등록하기</Button>
                  : <Button size="md" onClick={() => navigate('/')}>상품 보러가기</Button>
              }
            />
          )}
        </div>

        <div className="px-4 py-6 border-t border-cool-100">
          <Button variant="ghost" size="md" className="w-full" onClick={logout}>로그아웃</Button>
        </div>
      </div>

      {/* 닉네임 수정 */}
      <Modal
        open={nickOpen}
        onClose={() => setNickOpen(false)}
        title="닉네임 수정"
        footer={<Button size="lg" className="w-full" loading={savingNick} onClick={saveNickname}>저장</Button>}
      >
        <Input
          label="닉네임"
          value={nickname}
          maxLength={12}
          onChange={e => { setNickname(e.target.value); setNickError(''); }}
          error={nickError}
          hint="2~12자로 입력해 주세요."
        />
      </Modal>

      {/* 동네 재인증 */}
      <Modal open={regionOpen} onClose={() => setRegionOpen(false)} title="동네 재인증">
        <LocationVerifier
          intro="현재 위치를 기준으로 동네를 다시 인증해요. 이사했다면 새 동네로 바꿀 수 있어요."
          confirmLabel="이 동네로 변경"
          submitting={verifying}
          onConfirm={verifyLocation}
        />
      </Modal>
    </div>
  );
}

// ========================================
// 🚧 없는 페이지
// ========================================
function NotFoundPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <PageHeader title="페이지 없음" onBack={() => navigate('/')} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          emoji="🧭"
          title="주소를 찾을 수 없어요"
          description="입력한 주소가 잘못되었거나 삭제된 페이지예요."
          action={<Button size="md" onClick={() => navigate('/')}>홈으로 가기</Button>}
        />
      </div>
    </div>
  );
}

// ========================================
// 🚀 App — 인증 게이트 + 라우팅
// ========================================
function App() {
  const [status, setStatus] = useState('booting');   // booting | guest | ready
  const [user, setUser] = useState(null);
  const [unread, setUnread] = useState(0);
  const path = useHashPath();

  // 401 이 나면 어디서든 로그인 화면으로 (api 래퍼가 호출)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus('guest');
      navigate('/login', true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // 부팅: 토큰이 있으면 내 정보를 확인한다
  useEffect(() => {
    let alive = true;
    const boot = async () => {
      if (!tokenStore.get()) { if (alive) setStatus('guest'); return; }
      try {
        const data = await api('/auth/me');
        if (!alive) return;
        setUser(data.user);
        setStatus('ready');
      } catch (e) {
        if (!alive) return;
        tokenStore.clear();
        setUser(null);
        setStatus('guest');
      }
    };
    boot();
    return () => { alive = false; };
  }, []);

  // 라우트 가드 — 미로그인 상태로 다른 라우트에 오면 로그인으로 보낸다
  const isAuthPage = path === '/login' || path === '/signup';
  useEffect(() => {
    if (status === 'booting') return;
    if (status === 'guest' && !isAuthPage) navigate('/login', true);
    if (status === 'ready' && isAuthPage) navigate('/', true);
  }, [status, isAuthPage]);

  // 채팅 탭 뱃지 — 조용히 폴링하고, 로그아웃/언마운트 시 정리
  useEffect(() => {
    if (status !== 'ready') { setUnread(0); return; }
    let alive = true;
    const tick = async () => {
      try {
        const data = await api('/chats');
        if (!alive) return;
        const items = Array.isArray(data.items) ? data.items : [];
        setUnread(items.reduce((sum, r) => sum + toNum(r.unread, 0), 0));
      } catch (e) { /* 뱃지는 실패해도 조용히 넘어간다 */ }
    };
    tick();
    const timer = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [status, path]);

  const onAuthed = useCallback(u => { setUser(u); setStatus('ready'); }, []);
  const onLogout = useCallback(() => { setUser(null); setStatus('guest'); }, []);

  let content = null;
  let showTab = false;

  if (status === 'booting') {
    content = <BootScreen label="당근마켓을 여는 중…" />;
  } else if (status === 'guest') {
    if (path === '/signup') content = <SignupPage onAuthed={onAuthed} />;
    else if (path === '/login') content = <LoginPage onAuthed={onAuthed} />;
    else content = <BootScreen label="로그인 화면으로 이동 중…" />;
  } else {
    const routes = [
      { pattern: '/', render: () => { showTab = true; return <HomePage user={user} />; } },
      { pattern: '/product/:id', render: p => <ProductDetailPage id={p.id} user={user} /> },
      { pattern: '/new', render: () => <ProductFormPage mode="new" /> },
      { pattern: '/edit/:id', render: p => <ProductFormPage mode="edit" id={p.id} /> },
      { pattern: '/chats', render: () => { showTab = true; return <ChatsPage />; } },
      { pattern: '/chat/:roomId', render: p => <ChatRoomPage roomId={p.roomId} user={user} /> },
      { pattern: '/my', render: () => { showTab = true; return <MyPage user={user} onUser={setUser} onLogout={onLogout} />; } }
    ];

    for (const r of routes) {
      const params = matchRoute(r.pattern, path);
      if (params) { content = r.render(params); break; }
    }
    if (!content) {
      if (isAuthPage) content = <BootScreen label="홈으로 이동 중…" />;
      else content = <NotFoundPage />;
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#EDEEF0] flex justify-center">
      {/* 데스크톱에서는 가운데 정렬된 480px 폰 프레임 (SPEC 8절) */}
      <div className="w-full max-w-[480px] h-[100dvh] bg-white flex flex-col overflow-hidden shadow-xl">
        <div className="flex-1 min-h-0 flex flex-col">{content}</div>
        {showTab ? <BottomTab path={path} unread={unread} /> : null}
      </div>
    </div>
  );
}

// ========================================
// ▶ 렌더링
// ========================================
const rootEl = document.getElementById('root');
rootEl.innerHTML = '';
ReactDOM.createRoot(rootEl).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
window.__CARROT_MOUNTED__ = true;
