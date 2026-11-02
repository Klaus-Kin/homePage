import * as THREE from "three";
import type { Initialization } from "./initialization.ts";

type DecodeBitmap = (image: ImageBitmapSource, options: ImageBitmapOptions) => Promise<ImageBitmap>;

/** 在生成场景时异步预解码月面，避免首次 GPU 上传把图片解码一起压进同步渲染任务。 */
export async function prepareDecodedTexture(texture: THREE.Texture, init: Initialization,
  decode: DecodeBitmap | undefined = globalThis.createImageBitmap?.bind(globalThis),
  source: ImageBitmapSource = texture.image as ImageBitmapSource) {
  if (!decode) return;
  const started = performance.now();
  // ImageBitmap 忽略 WebGL 的 UNPACK_FLIP_Y 与预乘开关，必须在生成位图时保留原上传语义。
  // 关闭浏览器色域转换，由原纹理的 sRGB 设置继续完成与 HTMLImageElement 相同的采样。
  const prepared = await init.wait(decode(source, {
    imageOrientation: texture.flipY ? "flipY" : "none",
    premultiplyAlpha: texture.premultiplyAlpha ? "premultiply" : "none",
    colorSpaceConversion: "none",
  }).then(image => ({ image, dispose: () => image.close() })));
  // init.wait 负责在取消后关闭迟到位图；成功后关闭操作跟随同一初始化树，只执行一次。
  texture.image = prepared.image;
  texture.needsUpdate = true;
  performance.measure("moon-texture-decode", { start: started, end: performance.now() });
}

/** 从原始 Blob 解码，避免浏览器为 HTMLImageElement 同步取回解码像素；请求与离页共用取消信号。 */
export async function loadLunarTexture(url: string, init: Initialization) {
  const started = performance.now();
  const loadOriginal = async () => {
    const texture = await init.wait(new THREE.TextureLoader().loadAsync(url));
    performance.measure("moon-texture-download", { start: started, end: performance.now() });
    return texture;
  };
  if (typeof globalThis.createImageBitmap !== "function") return loadOriginal();
  const response = await init.waitFor(fetch(url, { signal: init.controller.signal }));
  if (!response.ok) throw new Error(`月面请求失败：${response.status} ${url}`);
  const source = await init.waitFor(response.blob());
  performance.measure("moon-texture-download", { start: started, end: performance.now() });
  const texture = init.track(new THREE.Texture());
  try {
    await prepareDecodedTexture(texture, init, undefined, source);
    return texture;
  } catch (error) {
    init.release(texture);
    init.check();
    // 可选解码失败仍沿用原图片路径；网络错误则保留上方的启动失败边界，不重复请求掩盖故障。
    console.warn("月面预解码不可用，沿用原图上传：", error);
    return loadOriginal();
  }
}
