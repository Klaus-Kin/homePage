import type { Initialization } from "./initialization.ts";
import { generateCloudPixels, generateRockPixels, generateSurfacePixels } from "./texture-pixels.ts";

export type PixelKind = "ground" | "rock" | "mountain" | "cloud" | "weathered-rock";

/** 原始 RGBA 无图片预乘、色彩转换或有损压缩；长度不符时明确报错并退回原算法。 */
export async function loadTexturePixels(kind: PixelKind, init: Initialization,
  request: typeof fetch = fetch): Promise<Uint8Array> {
  const width = kind === "cloud" || kind === "weathered-rock" ? 512 : 256;
  const height = kind === "weathered-rock" ? 512 : 256;
  try {
    init.check();
    const response = await init.waitFor(request(`/assets/texture-${kind}.rgba`, { signal: init.controller.signal }));
    if (!response.ok) throw new Error(`${kind}: HTTP ${response.status}`);
    const data = await init.waitFor(response.arrayBuffer());
    init.check();
    if (data.byteLength !== width * height * 4)
      throw new Error(`${kind}: RGBA 长度 ${data.byteLength}，应为 ${width * height * 4}`);
    return new Uint8Array(data);
  } catch (error) {
    init.check();
    console.warn(`预生成纹理 ${kind} 不可用，使用原始算法：`, error);
    const checkpoint = () => init.checkpoint();
    const pixels = kind === "cloud" ? await generateCloudPixels(checkpoint)
      : kind === "weathered-rock" ? await generateRockPixels(checkpoint)
      : await generateSurfacePixels(kind, checkpoint);
    return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  }
}
