---
name: ledger-db-reference
description: 가계부 앱 DB 구조·연결법·재사용 쿼리 — Postgres(Supabase) 단일 테이블 ledger_entries
metadata:
  type: reference
---

가계부 앱(`quest/week_5/1_server+DB_가계부앱`)이 쓰는 DB. 스키마 출처는 그 폴더의 `server.js`(initDB/CATEGORIES/SEED).

## DB 종류 & 연결
- **PostgreSQL (Supabase)**. `DATABASE_URL`은 `postgresql://...` 스킴.
- env: 공유 부모 `quest/week_5/.env`에서 읽음(앱 로컬 .env 우선 → 부모 .env). `OPENAI_MODEL=gpt-4o-mini`.
- 연결 시 `ssl: { rejectUnauthorized: false }` 필요(Supabase).
- **조회 실행 팁**: 내 폴더엔 node_modules 없음. 가계부 앱 폴더의 모듈을 절대경로 require로 재사용 →
  `require('<APP>/node_modules/pg')`, `require('<APP>/node_modules/dotenv').config({path:'<...>/week_5/.env'})`.
  Bash로 `node script.js` 실행 시 한글 출력 정상(JSON.stringify).

## 스키마 — 단일 테이블 `ledger_entries`
- `id` BIGSERIAL PK
- `type` TEXT — **'income' | 'expense'** (수입/지출 구분은 이 컬럼. amount는 항상 양의 정수)
- `entry_date` DATE — 조회 시 `to_char(entry_date,'YYYY-MM-DD')`로 문자열화(타임존 밀림 방지)
- `amount` BIGINT — 단위 "원", 양수만(CHECK > 0). pg가 문자열로 반환 → Number() 필요
- `category` TEXT (한글)
- `memo` TEXT, `created_at` TIMESTAMPTZ
- 테이블 접두사: `ledger_` (공유 Supabase 충돌 방지)

## 카테고리 분류
- **지출(expense)**: 식비, 카페/간식, 교통, 주거/통신, 생활/마트, 쇼핑/의류, 의료/건강, 문화/여가, 교육, 경조사/기타
- **수입(income)**: 급여, 용돈, 부수입, 금융수입, 기타

## 데이터 특성(2026-06 기준 시드)
- 데모 데이터: 2026-01~06. 매월 급여 320~330만 + 고정비 주거/통신 85만(월세+관리비)이 거의 매월 반복.
- 1~5월 월평균 지출 ≈ ₩1,190,600. 5월 ₩1,294,000.
- 주거/통신(고정비)이 보통 월 지출의 ~50% 차지.

## 재사용 쿼리
```sql
-- 특정 월 총지출
SELECT SUM(amount) FROM ledger_entries
WHERE type='expense' AND to_char(entry_date,'YYYY-MM')='2026-06';

-- 월별 카테고리 지출 분해
SELECT category, COUNT(*) cnt, SUM(amount) total FROM ledger_entries
WHERE type='expense' AND to_char(entry_date,'YYYY-MM')=$1
GROUP BY category ORDER BY total DESC;

-- 월별 추이(수입/지출)
SELECT to_char(entry_date,'YYYY-MM') m,
  SUM(amount) FILTER (WHERE type='income')  income,
  SUM(amount) FILTER (WHERE type='expense') expense
FROM ledger_entries GROUP BY 1 ORDER BY 1;
```

## 주중/주말 분석 패턴
- 요일: `EXTRACT(DOW FROM entry_date)` → 0=일,6=토. 주말 = `IN (0,6)`.
- **공정 비교는 1일 평균으로**: 주중일(약 2.5배 많음)이라 총액 비교는 불공정. 기간 내 달력 주중/주말 일수를 `generate_series(min,max,'1 day')`로 세서 총액÷일수.
- **왜곡 주의 — 고정비 제외하고 봐야 행태가 보임**: 월세(주거/통신 85만)가 매월 1일에 찍혀, 그 달 1일 요일에 따라 주중/주말로 들쭉날쭉(2026년 2·3월 1일=일요일→주말 분류). 소비 '행태' 분석 시 `category <> '주거/통신'` 제외 버전을 같이 본다.
- 발견(2026-01~06): 이 가계부는 **주중 지출형**. 월세 제외 1일평균 주중 ₩17,640 vs 주말 ₩5,404(주중 3.3배). 식비·생활/마트·쇼핑·의료·카페는 평일 집중, **교통·문화/여가만 주말 지향**. 주말 표본이 적어(월세 제외 6건) 기록 누락 가능성 있음.
