// 〈메이드 인 코리아〉 팬메이드 포스터 — 소재 이미지 생성 (fal.ai)
//
// 원칙 (DESIGN.md + 초상권):
//  - 공식 스틸을 직접 합성하지 않는다. 톤·구도만 참고해 새로 생성한다.
//  - 실존 배우(현빈·정우성·우도환)의 얼굴을 만들지 않는다.
//    → 세 인물 모두 "구조적으로 얼굴이 안 보이게" 설계했다.
//      ① 백기태  = 태극기·창 역광 실루엣 (검은 컷아웃)
//      ② 백기현  = 뒤통수/어깨너머 (계급장만 보임)
//      ③ 장건영  = 자료판을 향해 등을 보임
//    "얼굴 없는 세 男" 자체가 이 포스터의 컨셉이다.
//
// 실행:  node generate.mjs
// 출력:  generated/01-baek-gitae.jpg  02-baek-gihyun.jpg  03-jang-gunyoung.jpg

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "generated");

// .env 에서 키를 읽는다 (하드코딩 금지 — .env 는 gitignore 됨)
const env = await readFile(join(HERE, ".env"), "utf8");
const FAL_KEY = env.match(/FAL_KEY=(.+)/)?.[1]?.trim();
if (!FAL_KEY) throw new Error("FAL_KEY not found in .env");

// 세 컷 공통 — 우민호 톤 (DESIGN.md §5 팔레트)
const LOOK = [
  "1970s South Korean period crime-noir film still",
  "shot on 35mm anamorphic, heavy film grain, cinematic wide shot",
  "extreme chiaroscuro, crushed blacks, very low saturation",
  "no text, no letters, no watermark, no subtitles",
].join(", ");

const SHOTS = [
  {
    file: "01-baek-gitae.jpg",
    role: "백기태 — 권력의 정점 / 태극기 집무실 / 역광 실루엣",
    prompt: [
      "A man in a sharp 1970s suit stands in a dark government office, photographed directly INTO the light so he reads as a pure BLACK SILHOUETTE — a featureless dark cutout, face entirely unlit and unreadable, zero facial detail",
      "behind him a large South Korean Taegukgi flag on a gold-tasseled pole, glowing in the backlight; tall bright window casting long shadow bars across a cold blue-grey wall",
      "heavy dark executive desk in the foreground, brass lamp, rotary telephone",
      "the figure is small-to-medium in a wide dominant space, powerful and anonymous",
      "warm amber backlight against cold grey room, the red of the flag the only color in the frame",
      LOOK,
    ].join(", "),
  },
  {
    file: "02-baek-gihyun.jpg",
    role: "백기현 — 장성 / 야간 집무 / 어깨너머 뒷모습",
    prompt: [
      "OVER-THE-SHOULDER shot from BEHIND a South Korean army officer seated at a night desk — we see only the BACK of his head and his shoulders, face completely hidden from camera, no face visible",
      "star rank insignia on his shoulder board catching the light, olive military uniform, he holds a black bakelite telephone handset to his ear",
      "a huge dim tactical map covers the wall in front of him, old typewriter and desk lamp pooling warm amber light",
      "the room is almost entirely dark, single warm practical lamp, deep teal-black shadows",
      LOOK,
    ].join(", "),
  },
  {
    file: "03-jang-gunyoung.jpg",
    role: "장건영 — 추적자 / 수사 자료판 / 등을 보인 뒷모습",
    prompt: [
      "A lone prosecutor stands with his BACK FULLY TO THE CAMERA, facing a wall-sized investigation board — rear view only, back of head and rumpled overcoat, his face is not visible at all",
      "the board is covered in pinned photographs, documents, red string and chalk handwriting, lit hard from the side so it glows and he is a dark shape against it",
      "1970s office, venetian blinds, stacks of case files, black rotary phones on the desk behind him",
      "cold steel-blue light, cigarette haze in the beam, oppressive darkness around the edges",
      LOOK,
    ].join(", "),
  },
];

const NEGATIVE = [
  "face, facial features, eyes, portrait, close-up of a face, recognizable person, celebrity likeness",
  "text, title, logo, watermark, signature, caption",
  "bright, cheerful, saturated, modern, clean, high-key lighting",
].join(", ");

// 모델 폴백 체인: 화질 좋은 것부터 시도한다
const MODELS = [
  { id: "fal-ai/flux-pro/v1.1-ultra", body: (p) => ({ prompt: p, aspect_ratio: "16:9", output_format: "jpeg", safety_tolerance: "5", raw: false }) },
  { id: "fal-ai/flux/dev",            body: (p) => ({ prompt: p, image_size: "landscape_16_9", num_inference_steps: 40, guidance_scale: 4.0, enable_safety_checker: false }) },
  { id: "fal-ai/flux/schnell",        body: (p) => ({ prompt: p, image_size: "landscape_16_9", num_inference_steps: 4, enable_safety_checker: false }) },
];

async function gen(shot) {
  for (const model of MODELS) {
    const payload = { ...model.body(shot.prompt), negative_prompt: NEGATIVE };
    const res = await fetch(`https://fal.run/${model.id}`, {
      method: "POST",
      headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const msg = (await res.text()).slice(0, 200);
      console.log(`   ↳ ${model.id} 실패 (${res.status}) ${msg}`);
      continue; // 다음 모델로
    }

    const data = await res.json();
    const url = data?.images?.[0]?.url;
    if (!url) { console.log(`   ↳ ${model.id}: 이미지 URL 없음`); continue; }

    const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(join(OUT, shot.file), bin);
    console.log(`   ✓ ${shot.file}  ${(bin.length / 1024).toFixed(0)}KB  [${model.id}]`);
    return true;
  }
  console.log(`   ✗ ${shot.file} — 모든 모델 실패`);
  return false;
}

await mkdir(OUT, { recursive: true });
console.log("메이드 인 코리아 — 포스터 소재 생성 (얼굴 없는 세 인물)\n");
for (const shot of SHOTS) {
  console.log(`[${shot.role}]`);
  await gen(shot);
}
console.log("\n완료 → generated/");
