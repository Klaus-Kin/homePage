import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleGrassTuft, grassCountForBudget } from "../src/scene/grass-distribution.ts";
import { seededRandom } from "../src/scene/terrain-math.ts";
import { sceneConfig } from "../src/config.ts";

// 检查实际采样结果：同簇叶片必须扎根在很小的范围内，同时保持高矮变化。
test("grass grows from compact shared roots with varied blade heights", () => {
  const random = seededRandom(842);
  let tufts = 0;
  for (let i = 0; i < 2000; i++) {
    const tuft = sampleGrassTuft(random);
    if (!tuft) continue;
    tufts++;
    assert.ok(tuft.blades.length >= 12 && tuft.blades.length <= 18);
    for (const blade of tuft.blades) {
      assert.ok(Math.hypot(blade.x - tuft.x, blade.z - tuft.z) < 0.075);
      assert.ok(blade.size > 0 && Number.isFinite(blade.lean));
    }
    const heights = tuft.blades.map(blade => blade.size);
    assert.ok(Math.max(...heights) > Math.min(...heights) * 1.35);
  }
  assert.ok(tufts > 150, "采样不能只留下少数草簇");
});

// 留白来自疏密斑块；原先横贯草坡的整条禁生带应重新出现草簇，避免把草坪切成两半。
test("grass patches leave scattered clearings without cutting the meadow in two", () => {
  const random = seededRandom(234);
  const occupied = new Set<number>();
  const cells = new Set<string>();
  let crossingTufts = 0, tufts = 0;
  // 按桌面实际可容纳的约四百簇采样，避免无限重采样把所有候选空格都填满。
  for (let i = 0; i < 6000 && tufts < 400; i++) {
    const tuft = sampleGrassTuft(random);
    if (!tuft) continue;
    tufts++;
    const clearingZ = 4 + Math.sin(tuft.x * 0.38) * 1.2;
    if (Math.abs(tuft.z - clearingZ) < 0.75) crossingTufts++;
    occupied.add(Math.floor((tuft.x + 12) / 4));
    cells.add(`${Math.floor(tuft.x)},${Math.floor(tuft.z)}`);
  }
  assert.equal(occupied.size, 6, "草簇仍需覆盖整个横向范围");
  assert.ok(crossingTufts > 10, "中间不能保留横穿画面的禁生带");
  assert.ok(cells.size > 100 && cells.size < 360, "草簇与零散空地需要同时存在");
  assert.deepEqual(sampleGrassTuft(seededRandom(91)), sampleGrassTuft(seededRandom(91)));
});

// 降档只能在整簇边界处截断；桌面和手机同时减少叶片预算。
test("quality budgets reduce density and preserve complete tufts", () => {
  assert.ok(sceneConfig.quality.desktop.grass <= 6500);
  assert.ok(sceneConfig.quality.mobile.grass <= 2500);
  const ends = [14, 30, 43, 61];
  assert.equal(grassCountForBudget(ends, 42), 30);
  assert.equal(grassCountForBudget(ends, 43), 43);
  assert.equal(grassCountForBudget(ends, 100), 61);
  assert.equal(grassCountForBudget(ends, 0), 0);
});
