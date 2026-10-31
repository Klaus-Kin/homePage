import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCrown, createMonkey, createEntryModel, disposeModel } from "../src/entry-models.ts";
import { Initialization } from "../src/scene/initialization.ts";

// 比较真实缓冲、材质参数和动画采样；同步导出与分批运行必须产生同一个模型。
function snapshot(model: ReturnType<typeof createMonkey>) {
  return model.root.children.map(object => {
    const mesh = object as THREE.Mesh;
    const material = mesh.material as THREE.Material;
    const { uuid: _uuid, ...json } = material.toJSON();
    return { matrix: mesh.matrix.toArray(), rotation: model.root.rotation.toArray(), visible: mesh.visible,
      attributes: Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key, attr]) => [key, Array.from(attr.array)])),
      index: mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null, material: json };
  });
}

for (const [kind, factory] of [["crown", createCrown], ["monkey", createMonkey]] as const) {
  test(`${kind} build yields browser tasks and matches synchronous geometry and animation`, async () => {
    let time = 0, yields = 0, timerRan = false;
    const init = new Initialization(() => ++time, () => new Promise(resolve => setTimeout(() => {
      yields++; timerRan = true; resolve();
    }, 0)));
    const pending = createEntryModel(kind, init);
    assert.equal(timerRan, false);
    const batched = await pending, sync = factory();
    assert.ok(yields > 2, "模型内部必须分批，不能只延迟整个同步工厂");
    for (const sample of [[0, 0, 0, 0], [937, 1, .7, 1], [5937, .3, .2, .4]]) {
      sync.update(...sample as [number, number, number, number]);
      batched.update(...sample as [number, number, number, number]);
      assert.deepEqual(snapshot(batched), snapshot(sync));
    }
    init.dispose(); disposeModel(sync.root);
  });
}

// 在扫描和合批等不同检查点取消；所有已分配资源都必须且只能释放一次。
test("cancelled entry builds release partial resources once and never deliver a model", async () => {
  for (const cancelAt of [2, 4, 20, 80]) {
    let time = 0, yields = 0;
    const counts = new Map<object, number>();
    const init = new Initialization(() => ++time, async () => { if (++yields === cancelAt) init.dispose(); });
    const track = init.track.bind(init);
    init.track = resource => {
      if (!counts.has(resource)) {
        counts.set(resource, 0);
        (resource as THREE.EventDispatcher).addEventListener("dispose" as never, (() => counts.set(resource, counts.get(resource)! + 1)) as never);
      }
      return track(resource);
    };
    await assert.rejects(createEntryModel("monkey", init), { name: "AbortError" });
    init.dispose();
    assert.ok(counts.size > 0);
    assert.ok([...counts.values()].every(count => count === 1));
  }
});
