// 03 장건영(자료판) 재생성 — v1 문제: 자료판에 AI가 만든 '깨진 글자'가 선명히 읽힘
// (DESIGN.md는 AI 생성 텍스트 금지). 해결: 자료판을 '아웃포커스'로 만들어
// 글자 자체가 판독 불가가 되게 한다. 자료판은 '사진+빨간 실+핀'의 기호로만 읽히면 된다.
// 후보 2장 생성 → 눈으로 보고 poster.html 에 넣을 것을 고른다.
import { writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAL_KEY = (await readFile(join(HERE, ".env"), "utf8")).match(/FAL_KEY=(.+)/)[1].trim();

const COMMON =
  "cold steel-blue light, venetian blinds casting hard slats, faint cigarette haze in a shaft of light, " +
  "1970s South Korean office, deep shadow crushing the edges of the frame, " +
  "1970s period crime-noir film still, shot on 35mm anamorphic, heavy film grain, " +
  "extreme chiaroscuro, crushed blacks, very low saturation, desaturated";

const NEGATIVE =
  "text, letters, words, handwriting, captions, writing, numbers, typography, legible document, " +
  "sign, poster on wall, face of the man, his face, facial features, recognizable person, celebrity, " +
  "bright, saturated, modern, clean";

const CANDS = [
  {
    file: "03-jang-gunyoung-v2a.jpg",
    prompt:
      "Photographed from directly BEHIND a lone man in a rumpled dark 1970s overcoat, his BACK FULLY TO THE CAMERA, face not visible at all, " +
      "standing and facing a large wall investigation board. " +
      "The board is strongly OUT OF FOCUS with a shallow depth of field, softly blurred bokeh — " +
      "a dense collage of small old black-and-white PHOTOGRAPHS, taut RED STRING connecting pushpins, and pale blank index cards, " +
      "with no readable writing anywhere, the papers deliberately blurred and unreadable. " +
      "The man in the foreground is the only sharp element, a dark shape against the glowing soft board. " +
      COMMON,
  },
  {
    file: "03-jang-gunyoung-v2b.jpg",
    prompt:
      "Rear view over the shoulder of a lone detective, BACK TO CAMERA, face hidden, silhouetted against a dim investigation wall. " +
      "The wall is deep in shadow and OUT OF FOCUS — only pinned black-and-white PHOTOGRAPHS and threads of RED STRING catch a thin rim of cold light, " +
      "the rest dissolving into blurred darkness, blank unreadable papers, no text of any kind. " +
      "Tight, oppressive, most of the frame near-black. " +
      COMMON,
  },
];

for (const c of CANDS) {
  const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1-ultra", {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: c.prompt,
      negative_prompt: NEGATIVE,
      aspect_ratio: "16:9",
      output_format: "jpeg",
      safety_tolerance: "5",
    }),
  });
  if (!res.ok) { console.log(`✗ ${c.file}: ${res.status} ${(await res.text()).slice(0,160)}`); continue; }
  const url = (await res.json()).images[0].url;
  const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
  await writeFile(join(HERE, "generated", c.file), bin);
  console.log(`✓ ${c.file}  ${(bin.length/1024).toFixed(0)}KB`);
}
