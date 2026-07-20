---
name: project-week2-html-progression
description: The week_2 in-class teaching sequence for HTML/CSS/JS/React and which file teaches what
metadata:
  type: project
---

week_2's date-prefixed in-class folders form a deliberate learning ladder (all single-file `index.html`, no build step):

1. `week_2/260602/index.html` — rawest HTML: bare `<h1>/<h2>/<h3>` headings, no doctype/head/css. Point: HTML tags = structure, headings have built-in sizes ("왜 작아요?").
2. `week_2/260602-2/index.html` + `client.js` — explicit titled lesson "HTML / CSS / JS 의미 예제": HTML=구조(뼈대), CSS(Tailwind)=꾸미기, JS=변화/상태. Introduces full doctype, `<meta charset/viewport>`, semantic `<main>/<section>`, `id` attributes, and a vanilla-JS dancer toggle (querySelector, addEventListener, setInterval, style.transform).
3. `week_2/260602-3/index.html` — React-in-browser via CDN (react@18 UMD + Babel standalone, `<script type="text/babel">`), `<div id="root">`, component composition (Hero/Card/Section), useState checklists. Ham-tteokbokki recipe page.
4. `week_2/260602-4/index.html` — BMI 계산기: same React-CDN stack, `<input type="number">`, controlled inputs, conditional render, custom CSS in `<style>`.
5. `week_2/260602-5/index.html` — 달러↔원화 변환기: useState/useMemo/useCallback, two-way bound inputs, inline `<svg>`.

Standard `<head>` boilerplate established from 260602-2 onward: `<!DOCTYPE html>`, `<html lang="ko">`, `<meta charset="UTF-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1.0">`, Tailwind CDN `https://cdn.tailwindcss.com`.

**Why:** This sequence shows HTML was taught from absolute basics (tags/headings) escalating to React JSX, all client-side / no bundler — the consistent house style for the course.
**How to apply:** Any new week_2-style deliverable should be a single self-contained index.html using Tailwind CDN + (if interactive) React-CDN + Babel, `<html lang="ko">`, root `<div id="root">`. See [[project-workspace-structure]].
