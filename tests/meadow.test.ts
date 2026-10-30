import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createMeadowBlade, createWildflower, createSeedHead, vegetationReach } from "../src/scene/meadow-geometry.ts";
import { sampleMeadowBlade } from "../src/scene/meadow-distribution.ts";
import { createGroundSampler } from "../src/scene/ground-sampler.ts";
import { seededRandom } from "../src/scene/terrain-math.ts";
import { createGrassMaterials } from "../src/scene/grass-material.ts";
import { flowerReach, seedReach } from "../src/scene/meadow.ts";

// 长叶需要连续弧线、细尖和折脊；避让半径必须覆盖全部顶点及两个风摆端点。
test("curved meadow leaves have folded volume and conservative wind clearance", () => {
  const geometry = createMeadowBlade();
  const p = geometry.attributes.position;
  assert.ok(p.count >= 24);
  assert.ok(p.getZ(p.count - 1) > 0.2);
  for (const lean of [-.6, 0, .65]) {
    const matrix = new THREE.Matrix4().makeRotationZ(lean);
    for (let i = 0; i < p.count; i++) for (const wind of [-1, 1]) {
      const point = new THREE.Vector3().fromBufferAttribute(p, i);
      point.x += wind * point.y ** 2 * .24;
      point.applyMatrix4(matrix);
      assert.ok(Math.hypot(point.x, point.z) <= vegetationReach(1, lean));
    }
  }
  assert.ok(geometry.attributes.color.getX(0) < geometry.attributes.color.getX(12));
  geometry.dispose();
});

// 连片草甸仍保留低频疏密，三种高度有清晰差别，随机种子可重现。
test("meadow layers vary height and density while covering the foreground", () => {
  const heights: number[] = [];
  for (const layer of ["turf", "grass", "long"] as const) {
    const random = seededRandom(901), samples = [];
    for (let i = 0; i < 5000; i++) {
      const blade = sampleMeadowBlade(random, layer);
      if (blade) samples.push(blade);
    }
    assert.ok(samples.length > 500 && samples.length < 4900);
    assert.ok(samples.some(p => p.z > 12));
    assert.ok(samples.some(p => p.z < -2));
    assert.ok(samples.some(p => p.x < -10) && samples.some(p => p.x > 10));
    heights.push(samples.reduce((sum, p) => sum + p.height, 0) / samples.length);
    assert.deepEqual(sampleMeadowBlade(seededRandom(91), layer), sampleMeadowBlade(seededRandom(91), layer));
  }
  assert.ok(heights[1] > heights[0] * 1.5 && heights[2] > heights[1] * 1.3);
});

// 花瓣和穗粒必须依附完整茎叶，花株着色及阴影使用同一组风场对象。
test("whole flowers and seed heads are grounded meshes with synchronized wind shadows", () => {
  const flower = createWildflower();
  assert.equal(flower.userData.petals, 5);
  assert.equal(flower.userData.leaves, 3);
  flower.computeBoundingBox();
  assert.ok(Math.abs(flower.boundingBox!.min.y) < .002);
  assert.ok(flower.boundingBox!.max.y > .6);
  const seed = createSeedHead();
  seed.computeBoundingBox();
  assert.ok(seed.boundingBox!.max.y > .8);
  // 用实际花叶和穗粒的每个顶点检查两个极端风相位，避免只包住花心却漏掉伸出的叶片。
  for (const [geometry, strength, reach] of [[flower, 1.3, flowerReach(1)], [seed, .8, seedReach(1)]] as const) {
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) for (const direction of [-1, 1]) {
      const x = positions.getX(i) + direction * positions.getY(i) ** 2 * .24 * strength;
      assert.ok(Math.hypot(x, positions.getZ(i)) <= reach);
    }
  }
  const materials = createGrassMaterials({ flower: true, strength: 1.3 });
  const main = { uniforms: {}, vertexShader: "#include <begin_vertex>", fragmentShader: "#include <lights_fragment_end>" } as THREE.WebGLProgramParametersWithUniforms;
  const depth = { uniforms: {}, vertexShader: "#include <begin_vertex>" } as THREE.WebGLProgramParametersWithUniforms;
  materials.material.onBeforeCompile(main, {} as THREE.WebGLRenderer);
  materials.depth.onBeforeCompile(depth, {} as THREE.WebGLRenderer);
  assert.equal(main.vertexShader, depth.vertexShader);
  assert.equal(main.uniforms.uWindTime, depth.uniforms.uWindTime);
  assert.equal(main.uniforms.uWindStrength, depth.uniforms.uWindStrength);
  assert.equal(materials.material.emissiveIntensity, 0);
  materials.update(1, true);
  assert.equal(main.uniforms.uWindStrength.value, 0);
  for (const g of [flower, seed]) g.dispose();
  materials.material.dispose(); materials.depth.dispose();
});

// 网格三角形上的高度可能与连续噪声不同；根部只能采样实际绘制的两个三角面。
test("plant roots sample actual terrain triangles", () => {
  const ground = new THREE.PlaneGeometry(2, 2, 1, 1);
  ground.rotateX(-Math.PI / 2);
  const p = ground.attributes.position;
  p.setY(0, 0); p.setY(1, 1); p.setY(2, 2); p.setY(3, 7);
  const sample = createGroundSampler(ground, 1, 1);
  assert.equal(sample(-1, -1), 0);
  assert.equal(sample(1, 1), 7);
  assert.ok(Math.abs(sample(0, 0) - 1.5) < 1e-6);
  assert.ok(Math.abs(sample(.5, .5) - 4.25) < 1e-6);
  ground.dispose();
});
