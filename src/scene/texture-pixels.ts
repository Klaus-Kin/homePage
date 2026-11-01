import * as THREE from "three";
import { fbm, noise, seededRandom, groundTextureValue } from "./terrain-math.ts";

/** 离线生成与加载失败共用原始算法；行间让出由调用者提供，不改变取样顺序或像素取整。 */
type Checkpoint = () => Promise<void> | undefined | void;

export async function generateSurfacePixels(kind: "ground" | "rock" | "mountain", checkpoint: Checkpoint = () => {}) {
  const pixels = new Uint8ClampedArray(256 * 256 * 4);
  const random = seededRandom(81);
  for (let y = 0; y < 256; y++) {
    const pause = checkpoint(); if (pause) await pause;
    for (let x = 0; x < 256; x++) {
      // 岩面以缓慢色斑和极少量砂粒表现风化，避免高频随机颗粒被凹凸贴图放大成尖刺。
      const grain = random();
      const n = kind === "ground" ? groundTextureValue(x, y)
        : kind === "rock" ? fbm(x / 42, y / 42) * 0.22 + grain * 0.018 + 0.42
        : fbm(x / 22, y / 22) * 0.8 + grain * 0.2;
      const i = (y * 256 + x) * 4;
      const base = kind === "ground" ? [58, 66, 31] : [102, 112, 123];
      for (let c = 0; c < 3; c++) pixels[i + c] = base[c] * (0.4 + n);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

/** 云的透明边缘与原先 Canvas ImageData 使用相同的钳位取整。 */
export async function generateCloudPixels(checkpoint: Checkpoint = () => {}) {
  const pixels = new Uint8ClampedArray(512 * 256 * 4);
  for (let y = 0; y < 256; y++) {
    const pause = checkpoint(); if (pause) await pause;
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
      pixels[i] = 145 + light * 80;
      pixels[i + 1] = 159 + light * 74;
      pixels[i + 2] = 184 + light * 60;
      pixels[i + 3] = Math.min(235, density * 650);
    }
  }
  return pixels;
}

/** 岩面 alpha 是高度数据，必须保留 Uint8Array 截断语义并以原始 RGBA 保存。 */
export async function generateRockPixels(checkpoint: Checkpoint = () => {}) {
  const size = 512, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const pause = checkpoint(); if (pause) await pause;
    for (let x = 0; x < size; x++) {
      // 周期域混合使三向投影重复时首尾相接；高度与颜色分离，浅色矿物不会自动变成凸包。
      const sample = (scale: number, offset = 0) => {
        const u = x / (size - 1), v = y / (size - 1);
        const sx = u * u * (3 - 2 * u), sy = v * v * (3 - 2 * v);
        const top = noise(u * scale + offset, v * scale + offset) * (1 - sx)
          + noise((u - 1) * scale + offset, v * scale + offset) * sx;
        const bottom = noise(u * scale + offset, (v - 1) * scale + offset) * (1 - sx)
          + noise((u - 1) * scale + offset, (v - 1) * scale + offset) * sx;
        return top * (1 - sy) + bottom * sy;
      };
      const broad = sample(5, 7), medium = sample(22, 29), grain = sample(130, 51);
      const warp = sample(12, 91);
      const seam = Math.abs(Math.sin((x / (size - 1) * 6 + y / (size - 1) * 4) * Math.PI
        + (warp - .5) * 4));
      const crack = Math.max(0, 1 - seam / .085) * (.35 + medium * .65);
      const mineral = THREE.MathUtils.smoothstep(medium + (grain - .5) * .38, .53, .72);
      const moss = THREE.MathUtils.smoothstep(broad - medium * .24, .55, .72);
      const crystal = THREE.MathUtils.smoothstep(grain, .7, .88);
      const base = 70 + broad * 30 + medium * 20 + grain * 20 + mineral * 24 + crystal * 40 - crack * 28;
      const i = (y * size + x) * 4;
      // 中性灰由实时冷月光染色；苔藓低饱和且较暗，不在夜色中泛亮绿。
      pixels[i] = THREE.MathUtils.lerp(base * .97, 42 + grain * 18, moss);
      pixels[i + 1] = THREE.MathUtils.lerp(base, 48 + grain * 20, moss);
      pixels[i + 2] = THREE.MathUtils.lerp(base * 1.02, 29 + grain * 13, moss);
      pixels[i + 3] = Math.round(THREE.MathUtils.clamp(.47 + (medium - .5) * .25
        + (grain - .5) * .25 + crystal * .04 - crack * .22 + moss * .06, 0, 1) * 255);
    }
  }
  return pixels;
}
