---
name: rapa-cert-v2
description: RAPA 증명서 발급 시스템 v2 — plan is in DEV.md; MISSION.md's form description is factually wrong; v1 is live; runs on shared NAS, multi-user
metadata:
  type: project
---

RAPA 증명서 자동 발급 시스템 (app: `RAPA/`, plan: `quest/week_6/3_Planning_개인_프로젝트/DEV.md`).

**⚠️ MISSION.md's 양식 description is WRONG. Trust DEV.md (발견 1~5), which is grounded in an actual teardown of `(양식) 수료증_LIG 3기.pdf`.**
Specifically: the 선도기업/RAPA logos are **background watermarks behind the body paragraph**, not signature-block marks. The signature block is plain 2-column text. MISSION.md depicts `[로고 + 직인]` next to each org name — that layout does not exist in the real form.

**Why:** MISSION.md was written from the PDF's *extracted text*, which flattens layout. The image placement coordinates tell the real story.

**How to apply:** Before touching the 수료증 template, re-read DEV.md's 발견 section. Rebuilding from MISSION.md's description produces a document that does not match the official form.

**Confirmed decisions (2026-07-13):**
- Architecture: single `index.html` (CDN React) + `single.js` (Express) + **SQLite**.
- 🔴 **Runs on the shared office NAS, used by multiple 담당자** — not a single-user local tool. This is the fact most likely to be mis-assumed from an early skim.
- **No login/PIN** (사내망 신뢰 기반) but **`issued_by` IS recorded**. Attribution, not authentication — don't conflate them.
- 수료 판정 = `80%이상수료` + `수료후취업`.
- 40-page printing happens in the **담당자's browser**. No server-side puppeteer on the NAS.

**Load-bearing gotchas:**
- **v1 is deployed and still issuing certificates** (720건, next `RAPA26-AXDX-0721`). The Google-Sheet ledger is a **moving target** — any sheet→DB migration must be re-run at cutover, never reused from an earlier dry-run snapshot.
- 수강확인증·참여확인서 use v1's layout, **validated by 720 real issuances — do not touch them.** Only 수료증 + 상장 2종 get the new co-issued form.
- The sheet's `담당자` column is **not** the issuer — `Code.gs:309` fills it from HRD-Net `_2`'s `trprChap` (과정 담당자, printed on the cert). v1 never recorded who actually pressed Issue, nor when.
- SQLite on a NAS is safe **only because the Node process runs on the NAS too**. Running the app on each PC with the DB on an SMB/NFS share would corrupt it.
- v1 called HRD-Net from Google's servers (Apps Script), so **there is no precedent that the office network allows outbound HTTPS to `hrd.work24.go.kr` from the NAS**. Verify before building.

Related: [[pdf-form-forensics]]
