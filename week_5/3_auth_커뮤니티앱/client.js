// ============================================================
// 커뮤니티 게시판 React app (client) — email/password + JWT 인증 포함
// Express + Postgres API 와 통신. index.html 이 Babel 로 로드.
//
// 화면 상태:
//   1) 비인증 → 로그인/회원가입 (AuthScreen)
//   2) 인증   → 커뮤니티 (CommunityApp)
//        - list   : 전체 글 최신순 목록(제목/작성자/작성시간) — 클릭 시 상세
//        - detail : 글 상세(제목/작성자/시간/내용) — 본인 글이면 수정/삭제
//        - write  : 새 글 작성
//        - edit   : 본인 글 수정
//
// 권한: 조회는 로그인한 누구나 모든 글. 수정/삭제 버튼은 본인 글에만 노출되고,
//       서버도 본인 글만 허용하므로 UI 우회 시도도 막힌다.
// ============================================================

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ============================================================
// 🔐 Auth token (localStorage)
// ============================================================
const TOKEN_KEY = 'community_token';

const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY) || null; }
    catch (_e) { return null; }
  },
  set: (token) => {
    try { localStorage.setItem(TOKEN_KEY, token); } catch (_e) { /* quota 등 무시 */ }
  },
  clear: () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch (_e) { /* 무시 */ }
  },
};

// ============================================================
// 📡 API helper
// ============================================================
// 모든 /api/... 호출에 자동으로 Bearer 토큰을 붙이고 { success, data, message } 를 파싱.
// 401 → 토큰 비우고 onUnauthorized() 로 인증 화면 복귀.
let unauthorizedHandler = () => {};
function setUnauthorizedHandler(fn) { unauthorizedHandler = fn; }

class AuthError extends Error {
  constructor(message) { super(message); this.name = 'AuthError'; }
}

async function api(path, options = {}) {
  const token = tokenStore.get();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(path, { ...options, headers });
  } catch (_networkErr) {
    throw new Error('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }

  let body = null;
  try { body = await res.json(); } catch (_e) { /* 비 JSON 응답 */ }

  if (res.status === 401) {
    tokenStore.clear();
    unauthorizedHandler();
    const msg = (body && body.message) || '로그인이 필요합니다.';
    throw new AuthError(msg);
  }

  if (!res.ok || !body || body.success === false) {
    const msg = (body && body.message) || '요청을 처리하지 못했습니다.';
    throw new Error(msg);
  }
  return body.data;
}

// 이메일 형식 검사(가벼운 클라이언트 검증; 진짜 검증은 서버가 한다)
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ============================================================
// ⏱️ 시간/표시 헬퍼
// ============================================================
const pad2 = (n) => String(n).padStart(2, '0');

// 목록용: 최근이면 상대시간, 오래되면 날짜.
function formatRelative(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

// 상세용: 전체 날짜+시각.
function formatFull(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 작성 후 1초 넘게 지나 수정됐으면 true (수정됨 배지용).
function isEdited(post) {
  if (!post || !post.updatedAt || !post.createdAt) return false;
  return new Date(post.updatedAt).getTime() - new Date(post.createdAt).getTime() > 1000;
}

// 작성자 표시 이름 (서버가 authorName 을 주지만, 없으면 이메일 @ 앞부분).
const authorLabel = (post) => post.authorName || (post.authorEmail ? post.authorEmail.split('@')[0] : '익명');

// ========================================
// 🎨 Design System Components
// ========================================
function Button({ variant = 'primary', size = 'md', loading = false, className = '', children, disabled, ...props }) {
  const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-400',
    secondary: 'bg-slate-200 text-slate-700 hover:bg-slate-300 focus:ring-slate-400',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-300',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 focus:ring-slate-300',
  };
  const sizes = {
    sm: 'text-sm px-3 py-1.5',
    md: 'text-sm px-4 py-2.5',
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="-ml-1 mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

const Input = React.forwardRef(function Input({ className = '', invalid = false, ...props }, ref) {
  const border = invalid
    ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
    : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-200';
  return (
    <input
      ref={ref}
      className={`w-full rounded-lg border bg-white px-4 py-2.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 ${border} ${className}`}
      {...props}
    />
  );
});

const Textarea = React.forwardRef(function Textarea({ className = '', invalid = false, rows = 9, ...props }, ref) {
  const border = invalid
    ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
    : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-200';
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`w-full resize-y rounded-lg border bg-white px-4 py-2.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 ${border} ${className}`}
      {...props}
    />
  );
});

function Field({ label, htmlFor, error, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function Card({ className = '', children }) {
  return (
    <div className={`rounded-2xl bg-white shadow-xl shadow-slate-200/60 ${className}`}>
      {children}
    </div>
  );
}

// 작성자 아바타(이름 첫 글자)
function Avatar({ name, size = 'sm' }) {
  const dim = size === 'lg' ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-xs';
  return (
    <span className={`flex flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold uppercase text-indigo-600 ${dim}`}>
      {(name || '?').charAt(0)}
    </span>
  );
}

// 비차단 에러 토스트(화면 하단 중앙).
function ErrorToast({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        role="alert"
        className="toast-in pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 shadow-lg shadow-red-200/40"
      >
        <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-8-4a1 1 0 00-1 1v3a1 1 0 102 0V7a1 1 0 00-1-1zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <p className="flex-1 text-sm text-slate-700">{message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="알림 닫기"
          className="flex-shrink-0 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// 로딩 스피너 블록(목록/상세 공용)
function LoadingBlock({ label = '불러오는 중...' }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-4 py-12 text-center">
      <svg className="mb-3 h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}

// ========================================
// 📄 Auth Screen (로그인 / 회원가입)
// ========================================
function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef(null);

  const isSignup = mode === 'signup';

  const switchMode = (next) => {
    setMode(next);
    setErrors({});
    setFormError('');
    setConfirm('');
  };

  useEffect(() => {
    emailRef.current && emailRef.current.focus();
  }, [mode]);

  const validate = () => {
    const next = {};
    if (!email.trim()) next.email = '이메일을 입력해 주세요.';
    else if (!isValidEmail(email.trim())) next.email = '올바른 이메일 형식이 아닙니다.';

    if (!password) next.password = '비밀번호를 입력해 주세요.';
    else if (password.length < 6) next.password = '비밀번호는 6자 이상이어야 합니다.';

    if (isSignup) {
      if (!confirm) next.confirm = '비밀번호를 한 번 더 입력해 주세요.';
      else if (password !== confirm) next.confirm = '비밀번호가 일치하지 않습니다.';
    }
    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const path = isSignup ? '/api/auth/signup' : '/api/auth/login';
      const data = await api(path, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      tokenStore.set(data.token);
      onAuthed(data.user);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 px-4 py-10">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-300/50">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.84L3 20l1.06-3.18A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">커뮤니티</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isSignup ? '계정을 만들고 이야기를 나눠보세요.' : '로그인하고 커뮤니티에 참여하세요.'}
          </p>
        </header>

        <Card className="p-6 sm:p-7">
          <div className="mb-5 flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="인증 모드">
            {[
              { key: 'login', label: '로그인' },
              { key: 'signup', label: '회원가입' },
            ].map((t) => {
              const active = mode === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchMode(t.key)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                    active ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field label="이메일" htmlFor="auth-email" error={errors.email}>
              <Input
                id="auth-email"
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                invalid={!!errors.email}
                disabled={submitting}
              />
            </Field>

            <Field label="비밀번호" htmlFor="auth-password" error={errors.password}>
              <Input
                id="auth-password"
                type="password"
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6자 이상"
                invalid={!!errors.password}
                disabled={submitting}
              />
            </Field>

            {isSignup && (
              <Field label="비밀번호 확인" htmlFor="auth-confirm" error={errors.confirm}>
                <Input
                  id="auth-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="비밀번호를 한 번 더 입력"
                  invalid={!!errors.confirm}
                  disabled={submitting}
                />
              </Field>
            )}

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {formError}
              </div>
            )}

            <Button type="submit" loading={submitting} className="w-full" size="md">
              {isSignup ? '회원가입' : '로그인'}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            {isSignup ? '이미 계정이 있으신가요? ' : '아직 계정이 없으신가요? '}
            <button
              type="button"
              onClick={() => switchMode(isSignup ? 'login' : 'signup')}
              className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none"
            >
              {isSignup ? '로그인' : '회원가입'}
            </button>
          </p>
        </Card>

        <p className="mt-6 text-center text-xs text-slate-400">
          비밀번호는 안전하게 암호화되어 저장됩니다.
        </p>
      </div>
    </div>
  );
}

// ========================================
// 🧾 게시글 목록 아이템 (제목 / 작성자 / 작성시간)
// ========================================
function PostListItem({ post, isMine, onOpen }) {
  return (
    <li className="item-in">
      <button
        type="button"
        onClick={() => onOpen(post.id)}
        className="group flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3.5 text-left transition-shadow hover:border-indigo-200 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-slate-800 group-hover:text-indigo-600">
              {post.title}
            </h3>
            {isMine && (
              <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
                내 글
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
            <Avatar name={authorLabel(post)} />
            <span className="truncate font-medium text-slate-500">{authorLabel(post)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={post.createdAt} title={formatFull(post.createdAt)}>{formatRelative(post.createdAt)}</time>
            {isEdited(post) && <span className="text-slate-300">· 수정됨</span>}
          </div>
        </div>
        <svg className="h-5 w-5 flex-shrink-0 text-slate-300 group-hover:text-indigo-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </button>
    </li>
  );
}

// ========================================
// 📋 목록 화면
// ========================================
function PostList({ posts, loading, currentUserId, onOpen, onNew }) {
  return (
    <>
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">커뮤니티</h1>
          <p className="mt-1 text-sm text-slate-500">
            전체 글 <span className="font-semibold text-indigo-600">{posts.length}</span>개 · 최신순
          </p>
        </div>
        <Button onClick={onNew} className="flex-shrink-0">
          <svg className="-ml-1 mr-1.5 h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          글쓰기
        </Button>
      </header>

      <Card className="p-4 sm:p-5">
        {loading ? (
          <LoadingBlock />
        ) : posts.length > 0 ? (
          <ul className="space-y-2">
            {posts.map((post) => (
              <PostListItem
                key={post.id}
                post={post}
                isMine={Number(post.authorId) === Number(currentUserId)}
                onOpen={onOpen}
              />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-4 py-14 text-center">
            <svg className="mb-3 h-12 w-12 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.84L3 20l1.06-3.18A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="font-medium text-slate-500">아직 글이 없어요</p>
            <p className="mt-1 text-sm text-slate-400">첫 번째 글을 작성해 보세요.</p>
            <Button onClick={onNew} variant="secondary" size="sm" className="mt-4">글쓰기</Button>
          </div>
        )}
      </Card>
    </>
  );
}

// ========================================
// 📖 상세 화면 (본인 글이면 수정/삭제)
// ========================================
function PostDetail({ post, loading, isOwner, onBack, onEdit, onDelete }) {
  return (
    <>
      <div className="mb-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-indigo-600 focus:outline-none"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          목록으로
        </button>
      </div>

      <Card className="p-6 sm:p-7">
        {loading || !post ? (
          <LoadingBlock label="글을 불러오는 중..." />
        ) : (
          <article>
            <h1 className="break-words text-2xl font-bold leading-snug text-slate-900">{post.title}</h1>

            <div className="mt-3 flex items-center gap-2 border-b border-slate-100 pb-5 text-sm">
              <Avatar name={authorLabel(post)} size="lg" />
              <div className="min-w-0">
                <p className="font-semibold text-slate-700">{authorLabel(post)}</p>
                <p className="text-xs text-slate-400">
                  {formatFull(post.createdAt)}
                  {isEdited(post) && <span className="ml-1 text-slate-300">(수정됨 {formatFull(post.updatedAt)})</span>}
                </p>
              </div>
            </div>

            <div className="whitespace-pre-wrap break-words py-6 text-[15px] leading-relaxed text-slate-700">
              {post.content}
            </div>

            {isOwner && (
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-5">
                <Button variant="secondary" size="sm" onClick={() => onEdit(post)}>
                  수정
                </Button>
                <Button variant="danger" size="sm" onClick={() => onDelete(post.id)}>
                  삭제
                </Button>
              </div>
            )}
          </article>
        )}
      </Card>
    </>
  );
}

// ========================================
// ✍️ 작성/수정 폼 (write | edit 공용)
// ========================================
function PostForm({ mode, initialTitle = '', initialContent = '', onSubmit, onCancel }) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef(null);

  const isEdit = mode === 'edit';

  useEffect(() => {
    titleRef.current && titleRef.current.focus();
  }, []);

  const validate = () => {
    const next = {};
    const t = title.trim();
    if (!t) next.title = '제목을 입력해 주세요.';
    else if (t.length > 120) next.title = '제목은 120자 이하여야 합니다.';
    if (!content.trim()) next.content = '내용을 입력해 주세요.';
    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      // 성공 시 부모가 화면을 전환하며 이 폼을 unmount → submitting 유지돼도 무방.
      await onSubmit({ title: title.trim(), content: content.trim() });
    } catch (err) {
      if (err.name !== 'AuthError') setFormError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="mb-4">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-indigo-600 focus:outline-none"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          취소
        </button>
      </div>

      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">{isEdit ? '글 수정' : '새 글 작성'}</h1>
      </header>

      <Card className="p-6 sm:p-7">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="제목" htmlFor="post-title" error={errors.title}>
            <Input
              id="post-title"
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목을 입력하세요"
              maxLength={120}
              invalid={!!errors.title}
              disabled={submitting}
            />
          </Field>

          <Field label="내용" htmlFor="post-content" error={errors.content}>
            <Textarea
              id="post-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="내용을 입력하세요"
              maxLength={5000}
              invalid={!!errors.content}
              disabled={submitting}
            />
          </Field>

          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
              취소
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? '수정 완료' : '등록'}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}

// ========================================
// 🏛️ Community App (인증된 사용자 화면)
// ========================================
function CommunityApp({ user, onLogout }) {
  const [posts, setPosts] = useState([]);
  const [view, setView] = useState('list'); // list | detail | write | edit
  const [currentPost, setCurrentPost] = useState(null); // 상세/수정 대상(내용 포함)
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  // 최초: 전체 목록 로드 (401 은 api()가 인증 화면으로 처리)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await api('/api/posts');
        if (active) setPosts(rows);
      } catch (e) {
        if (active && e.name !== 'AuthError') setError(e.message);
      } finally {
        if (active) setListLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const goList = useCallback(() => {
    setError('');
    setCurrentPost(null);
    setView('list');
  }, []);

  // 상세 열기: 내용 포함 단건 조회.
  const openPost = useCallback(async (id) => {
    setError('');
    setCurrentPost(null);
    setView('detail');
    setDetailLoading(true);
    try {
      const post = await api(`/api/posts/${id}`);
      setCurrentPost(post);
    } catch (e) {
      if (e.name !== 'AuthError') {
        setError(e.message);
        setView('list');
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // 작성 (성공 시 목록 맨 앞에 추가하고 방금 쓴 글 상세로 이동)
  const createPost = useCallback(async ({ title, content }) => {
    const created = await api('/api/posts', { method: 'POST', body: JSON.stringify({ title, content }) });
    setPosts((prev) => [created, ...prev]);
    setCurrentPost(created);
    setView('detail');
  }, []);

  // 수정 (본인 글만 — 서버가 강제. 성공 시 목록/상세 동기화)
  const updatePost = useCallback(async ({ title, content }) => {
    const id = currentPost.id;
    const updated = await api(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify({ title, content }) });
    setCurrentPost(updated);
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setView('detail');
  }, [currentPost]);

  // 삭제 (본인 글만 — 서버가 강제)
  const deletePost = useCallback(async (id) => {
    if (!window.confirm('이 글을 삭제할까요? 삭제하면 되돌릴 수 없습니다.')) return;
    setError('');
    try {
      await api(`/api/posts/${id}`, { method: 'DELETE' });
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setCurrentPost(null);
      setView('list');
    } catch (e) {
      if (e.name !== 'AuthError') setError(e.message);
    }
  }, []);

  const startEdit = useCallback((post) => {
    setCurrentPost(post);
    setView('edit');
  }, []);

  const isOwner = !!currentPost && Number(currentPost.authorId) === Number(user.id);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        {/* 상단 바: 사용자 + 로그아웃 */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm text-slate-500">
            <Avatar name={user.name || user.email} />
            <span className="truncate" title={user.email}>{user.email}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={onLogout} className="flex-shrink-0">
            로그아웃
          </Button>
        </div>

        {view === 'list' && (
          <PostList
            posts={posts}
            loading={listLoading}
            currentUserId={user.id}
            onOpen={openPost}
            onNew={() => { setError(''); setCurrentPost(null); setView('write'); }}
          />
        )}

        {view === 'detail' && (
          <PostDetail
            post={currentPost}
            loading={detailLoading}
            isOwner={isOwner}
            onBack={goList}
            onEdit={startEdit}
            onDelete={deletePost}
          />
        )}

        {view === 'write' && (
          <PostForm mode="write" onSubmit={createPost} onCancel={goList} />
        )}

        {view === 'edit' && currentPost && (
          <PostForm
            mode="edit"
            initialTitle={currentPost.title}
            initialContent={currentPost.content}
            onSubmit={updatePost}
            onCancel={() => setView('detail')}
          />
        )}
      </div>

      <ErrorToast message={error} onClose={() => setError('')} />
    </div>
  );
}

// 전체 화면 로딩(앱 부팅 시 토큰 검증 중)
function BootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200">
      <div className="flex flex-col items-center text-center">
        <svg className="mb-3 h-9 w-9 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <p className="text-sm text-slate-400">불러오는 중...</p>
      </div>
    </div>
  );
}

// ========================================
// 🚀 App Component — 인증 게이트
// ========================================
// status: 'booting'(토큰 검증 중) | 'auth'(로그인 필요) | 'app'(인증됨)
function App() {
  const [status, setStatus] = useState('booting');
  const [user, setUser] = useState(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus('auth');
    });
  }, []);

  useEffect(() => {
    let active = true;
    const token = tokenStore.get();
    if (!token) {
      setStatus('auth');
      return;
    }
    (async () => {
      try {
        const data = await api('/api/auth/me'); // 200 → { user:{ id, email, name } }
        if (!active) return;
        setUser(data.user);
        setStatus('app');
      } catch (_e) {
        if (active) setStatus('auth');
      }
    })();
    return () => { active = false; };
  }, []);

  const handleAuthed = useCallback((u) => {
    setUser(u);
    setStatus('app');
  }, []);

  const handleLogout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('auth');
  }, []);

  if (status === 'booting') return <BootScreen />;
  if (status === 'auth') return <AuthScreen onAuthed={handleAuthed} />;
  return <CommunityApp user={user} onLogout={handleLogout} />;
}

// ========================================
// Rendering
// ========================================
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
