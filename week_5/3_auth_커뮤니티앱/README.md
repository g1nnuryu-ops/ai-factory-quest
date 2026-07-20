# 커뮤니티 게시판 (로그인 인증)

로그인한 사용자가 글을 작성/조회/수정/삭제하는 커뮤니티 게시판.
이메일·비밀번호 + JWT 인증, Express + Supabase(PostgreSQL).

## 🌐 배포 주소 (Live)

**https://quest-community-auth.vercel.app**

- Vercel 프로젝트: `quest-community-auth` (scope: `g1nnu-s-projects`)
- 재배포: `vercel deploy --prod`

## 기능

- **인증**: 회원가입 / 로그인 (비밀번호는 bcrypt 해시 저장, JWT 7일)
- **조회**: 로그인한 누구나 모든 글을 최신순으로 열람 (작성자 이름·작성시간 표시)
- **작성**: 로그인 사용자만 (작성자는 토큰의 계정으로 고정)
- **수정/삭제**: 본인이 쓴 글만 (서버에서 `user_id` 기준으로 강제)

## 구조 (3-file)

| 파일 | 역할 |
|---|---|
| `server.js` | Express API + JWT 인증 + Postgres 쿼리 |
| `index.html` | CDN React + Tailwind 진입점 |
| `client.js` | React 앱(목록 / 상세 / 작성 / 수정) |

DB 테이블: `users`(인증 공용), `community_posts`(게시글). 공용 Supabase를 다른 quest 앱과
공유하므로 도메인 테이블에 `community_` 접두사를 붙임.

## 로컬 실행

```bash
npm install
PORT=3003 npm start    # http://localhost:3003
```

`.env` 필요 (이 폴더, gitignore됨):

```
DATABASE_URL=postgresql://...   # Supabase connection string
JWT_SECRET=...                  # 토큰 서명 키
```

## API

| 메서드 | 경로 | 설명 | 인증 |
|---|---|---|---|
| POST | `/api/auth/signup` | 회원가입 | – |
| POST | `/api/auth/login` | 로그인 | – |
| GET | `/api/auth/me` | 내 정보 | ✅ |
| GET | `/api/posts` | 전체 글 목록(최신순, 내용 제외) | ✅ |
| GET | `/api/posts/:id` | 글 상세(내용 포함) | ✅ |
| POST | `/api/posts` | 글 작성 | ✅ |
| PATCH | `/api/posts/:id` | 글 수정 (본인만) | ✅ |
| DELETE | `/api/posts/:id` | 글 삭제 (본인만) | ✅ |
