import * as THREE from "three";
import type { Initialization } from "./initialization";
import { fbm, seededRandom } from "./terrain-math";

/** 纯色表面贴图只描述材质，不烘焙草叶、月光或阴影。 */
export async function surfaceTexture(kind: "ground" | "rock", init: Initialization) {
  init.phase = `texture-${kind}`;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(256, 256);
  const random = seededRandom(81);
  for (let y = 0; y < 256; y++) {
    const pause = init.checkpoint(); if (pause) await pause;
    for (let x = 0; x < 256; x++) {
      const n = fbm(x / 22, y / 22) * 0.8 + random() * 0.2;
      const i = (y * 256 + x) * 4;
      const base = kind === "rock" ? [102, 112, 123] : [58, 66, 31];
      for (let c = 0; c < 3; c++) image.data[i + c] = base[c] * (0.4 + n);
      image.data[i + 3] = 255;
    }
  }
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
  const pixels = context.createImageData(512, 256);
  for (let y = 0; y < 256; y++) {
    const pause = init.checkpoint(); if (pause) await pause;
    for (let x = 0; x < 512; x++) {
      const u = x / 512,
        v = y / 256;
      const envelope = Math.pow(
        Math.max(0, Math.sin(u * Math.PI) * Math.sin(v * Math.PI)),
        1.2,
      );
      const density =
        Math.max(0, fbm(x / 65 + 13, y / 52 + 5) - 0.29) * envelope;
      const light = Math.min(1, fbm(x / 65 + 13, (y - 8) / 52 + 5) + 0.37);
      const i = (y * 512 + x) * 4;
      pixels.data[i] = 145 + light * 80;
      pixels.data[i + 1] = 159 + light * 74;
      pixels.data[i + 2] = 184 + light * 60;
      pixels.data[i + 3] = Math.min(235, density * 650);
    }
  }
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
