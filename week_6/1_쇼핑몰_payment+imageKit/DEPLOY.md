# 배포 정보 — 우리 아이 마켓 (quest-shop-auth)

**프로덕션 URL (고정 alias):** https://quest-shop-auth.vercel.app

## 배포 상세
- 최신 배포 URL: https://quest-shop-auth-ihd35qrar-g1nnu-s-projects.vercel.app
- Inspector: https://vercel.com/g1nnu-s-projects/quest-shop-auth/YCWHnAhcAQbfnKsXHsCaxd6PYQND
- Vercel 프로젝트: `g1nnu-s-projects/quest-shop-auth`
- CLI 계정: `g1nnuryu-2700`
- 최근 배포: 2026-07-12

## 재배포
이 폴더에서 실행:
```
vercel --prod --yes
```

## 필수 환경변수 (Vercel Production)
로컬 `.env`는 `.vercelignore`로 업로드에서 제외됨 → 아래 값들이 Vercel 프로젝트 환경변수로 등록돼 있어야 배포본이 동작한다:
- `DATABASE_URL`, `JWT_SECRET` — 인증/DB
- `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` — 결제
- `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY` — 프로필 사진

확인/추가:
```
vercel env ls production
echo "<값>" | vercel env add <NAME> production
```

## 검증 (2026-07-12)
- `GET /api/products` → 200, 상품 12개 (DB 연결 OK)
- `GET /api/payments/config` → 200, clientKey 정상 (Toss 키 OK)
