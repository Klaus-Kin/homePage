import { test } from "node:test";
import assert from "node:assert/strict";
import { wornWoodGeometry } from "../src/scene/chest-wear.ts";

// 旧化只能向原木板内部收缩，保留六面材质槽、刻字 UV 和薄壁厚度，避免开合穿插。
test("aged panels stay inside the original solid and retain all six inscription faces", () => {
  for (const [w, h, d] of [[3.86, .44, .065], [3.86, .055, .604], [.065, .33, .604]]) {
    const geometry = wornWoodGeometry(w, h, d, .009);
    const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    assert.deepEqual(geometry.groups.map(group => group.materialIndex), [0, 1, 2, 3, 4, 5]);
    let worn = 0;
    for (let i = 0; i < positions.count; i++) {
      const xyz = [positions.getX(i), positions.getY(i), positions.getZ(i)];
      const distances = xyz.map((value, axis) => [w, h, d][axis] / 2 - Math.abs(value)).sort((a, b) => a - b);
      assert.ok(distances[0] >= -1e-6, "磨损不能向外凸出原轮廓");
      assert.ok(distances[0] < .015, "磕损不能深入薄木板内部");
      if (distances[0] > .004) worn++;
      assert.ok(Number.isFinite(normals.getX(i) + normals.getY(i) + normals.getZ(i)));
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1);
    }
    assert.ok(worn > 0, "轮廓应包含少量实际缺口");
    assert.ok(worn < positions.count * .2, "完整面板应占绝大部分");
    assert.ok(geometry.index!.count / 3 < 5000, "静态边缘采样保持有限几何开销");
    geometry.dispose();
  }
});
