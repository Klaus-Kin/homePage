import * as THREE from "three";
import type { Initialization } from "./initialization";
import { loadTexturePixels } from "./texture-cache.ts";

/** 纯色表面贴图只描述材质，不烘焙草叶、月光或阴影。 */
export async function surfaceTexture(kind: "ground" | "rock" | "mountain", init: Initialization) {
  init.phase = `texture-${kind}`;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const pixels = await loadTexturePixels(kind, init);
  const image = new ImageData(new Uint8ClampedArray(pixels), 256, 256);
  context.putImageData(image, 0, 0);
  const texture = init.track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === "ground" ? 25 : 2, kind === "ground" ? 20 : 2);
  texture.anisotropy = 4;
  return texture;
}

/** 云边缘使用连续密度场，四周衰减到透明；不会出现圆盘或矩形裁切边。 */
export async function cloudTexture(init: Initialization) {
  init.phase = "texture-cloud";
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const data = await loadTexturePixels("cloud", init);
  const pixels = new ImageData(new Uint8ClampedArray(data), 512, 256);
  context.putImageData(pixels, 0, 0);
  const texture = init.track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 光晕只用于空间中的小精灵，不覆盖全屏或掩盖地形边缘。 */
export function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.12, "#ffffffcc");
  gradient.addColorStop(0.4, "#ffffff25");
  gradient.addColorStop(1, "#ffffff00");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
