import { writeFile, readFile } from "node:fs/promises";
import { generateSurfacePixels, generateCloudPixels, generateRockPixels } from "../src/scene/texture-pixels.ts";

// 用 node --experimental-strip-types scripts/generate-texture-pixels.ts 重新生成固定种子的原始 RGBA。
// 同一算法同时服务运行时回退；写入后逐字节核对，岩面高度 alpha 不经过 PNG/Canvas 预乘。
for (const kind of ["ground", "rock", "mountain", "cloud", "weathered-rock"] as const) {
  const pixels = kind === "cloud" ? await generateCloudPixels()
    : kind === "weathered-rock" ? await generateRockPixels() : await generateSurfacePixels(kind);
  const url = new URL(`../public/assets/texture-${kind}.rgba`, import.meta.url);
  await writeFile(url, pixels);
  const saved = await readFile(url);
  if (!saved.equals(Buffer.from(pixels))) throw new Error(`${kind} 原始像素不一致`);
  console.log(`${kind}: ${saved.length} bytes verified`);
}
