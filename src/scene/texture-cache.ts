import type { Initialization } from "./initialization.ts";
import { generateCloudPixels, generateRockPixels, generateSurfacePixels } from "./texture-pixels.ts";

export type PixelKind = "ground" | "rock" | "mountain" | "cloud" | "weathered-rock";
const requests = new WeakMap<Initialization, Map<PixelKind, Promise<Uint8Array>>>();

/** 同一场景只下载和生成一次像素；提前请求可与月面解码、Worker 计算并行。 */
export function prefetchTexturePixels(init: Initialization) {
  for (const kind of ["ground", "mountain", "cloud", "weathered-rock"] as const)
    void loadTexturePixels(kind, init).catch(() => {});
}

/** 原始 RGBA 无图片预乘、色彩转换或有损压缩；长度不符时明确报错并退回原算法。 */
export function loadTexturePixels(kind: PixelKind, init: Initialization,
  request: typeof fetch = fetch): Promise<Uint8Array> {
  init.check();
  const root = init.root;
  let cache = requests.get(root);
  if (!cache) { cache = new Map(); requests.set(root, cache); root.cleanup(() => requests.delete(root)); }
  let pending = cache.get(kind);
  if (!pending) {
    pending = requestTexturePixels(kind, root, request).catch(error => { cache!.delete(kind); throw error; });
    cache.set(kind, pending);
  }
  // 下载归根任务所有，但每位消费者仍可独立取消，不能把迟到像素交给已释放的子场景。
  return init.waitFor(pending);
}

async function requestTexturePixels(kind: PixelKind, init: Initialization, request: typeof fetch): Promise<Uint8Array> {
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
