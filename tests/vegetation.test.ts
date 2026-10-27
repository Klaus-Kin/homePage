import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createGrassMaterials } from "../src/scene/grass-material.ts";

// 主通道和深度通道必须共用顶点变形与时间，避免风吹草动时投影仍停在原处。
test("grass depth pass shares wind deformation and refreshes shadows at a bounded rate", () => {
  const grass = createGrassMaterials();
  const main = { uniforms: {}, vertexShader: '#include <begin_vertex>' } as THREE.WebGLProgramParametersWithUniforms;
  const depth = { uniforms: {}, vertexShader: '#include <begin_vertex>' } as THREE.WebGLProgramParametersWithUniforms;
  grass.material.onBeforeCompile(main, {} as THREE.WebGLRenderer);
  grass.depth.onBeforeCompile(depth, {} as THREE.WebGLRenderer);
  assert.equal(main.vertexShader, depth.vertexShader);
  assert.equal(main.uniforms.uWindTime, depth.uniforms.uWindTime);
  assert.equal(grass.update(0, false), true);
  assert.equal(grass.update(0.01, false), false);
  assert.equal(grass.update(0.06, false), true);
  assert.equal(grass.update(0.07, true), true);
  assert.equal(main.uniforms.uWindStrength.value, 0);
  assert.equal(grass.update(1, true), false);
  grass.material.dispose(); grass.depth.dispose();
});

