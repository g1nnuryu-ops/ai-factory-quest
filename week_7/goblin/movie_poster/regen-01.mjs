// 01 백기태 재생성 — v1 문제: ① 왼쪽 깃발이 태극기가 아님 ② 붉은색 과다(DESIGN.md 3% 룰 위반)
// 수정: 태극기 1개만, 1970년대 목재 집무실, 깃발은 그늘 속에 어둡게. 역광 실루엣은 유지.
import { writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAL_KEY = (await readFile(join(HERE, ".env"), "utf8")).match(/FAL_KEY=(.+)/)[1].trim();

const prompt = [
  "A man in a 1970s suit stands behind a heavy desk in a dark government office, photographed straight INTO a tall bright window so he reads as a pure BLACK SILHOUETTE — a featureless dark cutout, his face completely unlit, no facial features whatsoever, an anonymous shape",
  "a SINGLE South Korean Taegukgi flag on a gold-tasseled pole stands beside him, hanging in shadow, its red and blue deep and muted, almost drained of color",
  "1970s interior: dark wood-panelled walls, horizontal venetian blinds slicing hard light bars across the room, brass banker's lamp, black rotary telephone, stacks of paper on the desk",
  "the man is medium-sized within a wide, dominant, oppressive space",
  "monochrome grey-blue room, blown-out white window light, almost no color anywhere",
  "1970s South Korean period crime-noir film still, shot on 35mm anamorphic, heavy film grain, cinematic wide shot",
  "extreme chiaroscuro, crushed blacks, very low saturation, desaturated",
  "no text, no letters, no watermark",
].join(", ");

const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1-ultra", {
  method: "POST",
  headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt,
    negative_prompt: "face, facial features, eyes, portrait, recognizable person, celebrity, bright red, saturated colors, multiple flags, modern office, text, logo, watermark",
    aspect_ratio: "16:9",
    output_format: "jpeg",
    safety_tolerance: "5",
  }),
});

if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const url = (await res.json()).images[0].url;
const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
await writeFile(join(HERE, "generated", "01-baek-gitae-v2.jpg"), bin);
console.log(`✓ 01-baek-gitae-v2.jpg  ${(bin.length / 1024).toFixed(0)}KB`);
