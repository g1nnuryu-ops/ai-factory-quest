---
name: pdf-form-forensics
description: Windows recipe to reverse-engineer an official PDF form's real layout (embedded images, placement coords, page render) — use before rebuilding a document template in HTML
metadata:
  type: reference
---

When you must reproduce an official document (증서/공문) in HTML, **do not trust the prose description** of the form — take the PDF apart. Text extraction alone hides layout (watermark vs. signature block look identical in extracted text).

Three passes, all with `py` on Windows (`PYTHONIOENCODING=utf-8` required for Korean):

1. **Text + image inventory** — `pypdf.PdfReader`, `page.images` → names/sizes. Reveals *how many* image assets and their real resolution.
2. **Placement coordinates** — regex the content stream for `q <a b c d e f> cm /Name Do`:
   `p.get_contents().get_data()` → `re.findall(r'q\s+([\d\.\-\s]+?)cm\s*/(\w+)\s+Do', data)`
   → `w=n[0] h=n[3] x=n[4] y=n[5]`, **origin bottom-left**. This is what tells you a logo is a background watermark (mid-page, behind body text) rather than a signature-block mark.
3. **Render to look at it** — `fitz` (PyMuPDF, already installed): `fitz.open(f)[0].get_pixmap(dpi=110).save(out)` then Read the PNG. Nothing beats seeing it.

Also: an official form's **seal images tell you the signing process**. If org A's seal is embedded as an image and org B's is absent, B stamps physically after printing — that answers "is mixed image/physical sealing allowed?" without asking anyone.

Embedded logos are often **1-bit dithered** (screen-toned) — fine at print size, ugly when scaled. Prefer requesting the original from the owner; treat PDF extraction as fallback.

Related: [[rapa-cert-v2]]
