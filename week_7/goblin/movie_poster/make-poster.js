#!/usr/bin/env node
/**
 * make-poster.js — fal.ai / openai gpt-image-2 로 〈메이드 인 코리아〉 팬메이드 포스터 생성
 *
 * 사용법:
 *   node make-poster.js <prompt.txt> <out.png> [w] [h] [img1 img2 ...]
 *
 * FAL_KEY: 환경변수 또는 이 스크립트 옆의 .env (FAL_KEY=...)
 * 참고: DESIGN.md — 제목 텍스트는 이미지 안에 넣지 않는다(한글 깨짐). 하단은 비워둔다.
 */
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'openai/gpt-image-2/edit';

function loadKey() {
  if (process.env.FAL_KEY?.trim()) return process.env.FAL_KEY.trim();
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^\s*FAL_KEY\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}

const toDataUri = (p) => {
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [promptFile, outPath, w = '1024', h = '1536', ...imgs] = process.argv.slice(2);
  if (!promptFile || !outPath || imgs.length === 0) {
    console.error('Usage: node make-poster.js <prompt.txt> <out.png> <w> <h> <img1> [img2 ...]');
    process.exit(2);
  }
  const FAL_KEY = loadKey();
  if (!FAL_KEY) { console.error('ERROR: FAL_KEY 없음 (.env 확인)'); process.exit(1); }

  const prompt = fs.readFileSync(promptFile, 'utf8').trim();
  const image_urls = imgs.map(toDataUri);
  const mb = (image_urls.join('').length / 1024 / 1024).toFixed(1);
  console.log(`[in] refs=${imgs.length} (${mb} MB base64)  size=${w}x${h}`);
  imgs.forEach((p) => console.log(`     - ${path.basename(p)}`));

  const headers = { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' };
  const input = {
    prompt,
    image_urls,
    image_size: { width: Number(w), height: Number(h) },
    quality: 'high',
    num_images: 1,
    output_format: 'png',
  };

  // 1) 큐에 제출
  const sub = await fetch(`https://queue.fal.run/${ENDPOINT}`, {
    method: 'POST', headers, body: JSON.stringify(input),
  });
  const subTxt = await sub.text();
  if (!sub.ok) { console.error(`제출 실패 HTTP ${sub.status}\n${subTxt}`); process.exit(1); }
  const { request_id, status_url, response_url } = JSON.parse(subTxt);
  console.log(`[queue] ${request_id}`);

  // 2) 폴링
  let status = '';
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    const st = await fetch(`${status_url}?logs=1`, { headers });
    const j = await st.json();
    if (j.status !== status) { status = j.status; console.log(`[status] ${status}`); }
    if (status === 'COMPLETED') break;
    if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) {
      console.error('실패:\n' + JSON.stringify(j, null, 2).slice(0, 2000));
      process.exit(1);
    }
  }
  if (status !== 'COMPLETED') { console.error('타임아웃'); process.exit(1); }

  // 3) 결과 수령
  const res = await fetch(response_url, { headers });
  const resTxt = await res.text();
  if (!res.ok) { console.error(`결과 실패 HTTP ${res.status}\n${resTxt}`); process.exit(1); }
  const data = JSON.parse(resTxt);
  const url = data?.images?.[0]?.url;
  if (!url) { console.error('이미지 URL 없음:\n' + resTxt.slice(0, 1500)); process.exit(1); }

  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log(`SAVED ${outPath}  ${(buf.length / 1024).toFixed(0)} KB  (${data.images[0].width}x${data.images[0].height})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
