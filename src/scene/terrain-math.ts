/** 可复现随机数使响应式重建保持同一片风景，也便于截图回归。 */
export function seededRandom(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** 平滑值噪声不依赖外部素材；用于地形、岩面和独立云纹理。 */
export function noise(x: number, y: number) {
  const hash = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let u = x - ix,
    v = y - iy;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  return (
    (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) +
    (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v
  );
}

export function fbm(x: number, y: number) {
  return (
    noise(x, y) * 0.55 +
    noise(x * 2.1, y * 2.1) * 0.27 +
    noise(x * 4.3, y * 4.3) * 0.12 +
    noise(x * 8.5, y * 8.5) * 0.06
  );
}

/** 宝盒附近平缓，远离后自然起伏并向山谷下降；近坡一直延伸到相机后方。 */
export function groundHeight(x: number, z: number) {
  // 平缓区覆盖上盖翻到左侧后的落点，避免完全展开时末端悬在山谷上方。
  const distance = Math.min(
    Math.hypot(x / 2.5, z / 1.5),
    Math.hypot((x - 0.2) / 3.5, (z + 1.2) / 4),
  );
  const blend = Math.min(1, Math.max(0, distance - 1));
  const smooth = blend * blend * (3 - 2 * blend);
  if (smooth === 0) return 0;
  return (
    smooth *
    ((fbm(x * 0.4 + 8, z * 0.4 + 6) - 0.5) * 0.85 -
      Math.max(0, -z - 1) * 0.52 -
      Math.max(0, -x - 3) * 0.2 +
      Math.max(0, z - 1) * 0.025)
  );
}

/** 域扭曲改变山脊走向，分形锐脊形成支脉和冲沟；各层使用独立种子而非平移复制。 */
export function mountainHeight(x: number, z: number, layer: number) {
  const seed = layer * 17.73;
  const center =
    (fbm(x * 0.037 + seed, 3 + seed) - 0.5) * 19 +
    Math.sin(x * 0.051 + layer) * 3;
  const offset = z - center;
  const span = 15 + noise(x * 0.075 + seed, 9) * 7;
  const envelope = Math.pow(Math.max(0, 1 - Math.abs(offset) / span), 1.15);
  const peak = 11 + Math.pow(noise(x * 0.085 + seed, seed + 5), 1.5) * 11;
  const warpedX = x * 0.19 + (fbm(x * 0.11, z * 0.12 + seed) - 0.5) * 2;
  const warpedZ = z * 0.16 + seed;
  let ridge = 0,
    amplitude = 1,
    frequency = 1,
    weight = 1;
  for (let octave = 0; octave < 5; octave++) {
    let signal =
      1 - Math.abs(noise(warpedX * frequency, warpedZ * frequency) * 2 - 1);
    signal *= signal * weight;
    ridge += signal * amplitude;
    weight = Math.min(1, signal * 2.4);
    frequency *= 2.13;
    amplitude *= 0.48;
  }
  return (
    -15 +
    envelope * (peak + ridge * 2.6) -
    Math.pow(envelope, 0.6) * Math.abs(offset) * 0.08
  );
}
