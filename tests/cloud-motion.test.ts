import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudMotion } from "../src/scene/cloud-motion.ts";

// 数秒内必须能看到位移，长时间运行及原十一秒周期边缘仍保持连续。
test("moon clouds and valley mist visibly move without resetting at cycle boundaries", () => {
  for (const i of [0, 1, 6, 12]) {
    assert.ok(Math.abs(cloudMotion(4, i, false).x - cloudMotion(0, i, false).x) > 0.25);
    for (const time of [11, 60, 600, 3600]) {
      const before = cloudMotion(time - 0.001, i, false), after = cloudMotion(time + 0.001, i, false);
      assert.ok(Math.abs(after.x - before.x) < 0.002);
      assert.ok(after.opacity > 0 && after.opacity < 1);
    }
    assert.deepEqual(cloudMotion(0, i, true), cloudMotion(3600, i, true));
  }
});
