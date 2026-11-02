import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildEntryArtwork } from "../src/entry-artwork.ts";
import { Initialization } from "../src/scene/initialization.ts";

// 运行时使用静态位置缓冲和共享 uniform；复色着色器仍需与羽毛顶点变形一起保留。
test("GPU feathers animate without uploading the position buffer each frame", () => {
  const init = new Initialization();
  const textures = [0, 1, 2].map(() => init.track(new THREE.Texture()));
  const model = buildEntryArtwork("crown", textures, init, textures, true);
  const feather = model.root.getObjectByName("artwork-feather-1") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const positions = feather.geometry.getAttribute("position") as THREE.BufferAttribute;
  const version = positions.version, before = positions.array.slice();
  for (let time = 0; time < 3000; time += 16) model.update(time, 1, 0, 0);
  assert.equal(positions.version, version); assert.deepEqual(positions.array, before);
  assert.ok(feather.geometry.getAttribute("featherWeight").count === positions.count);
  const shader = { uniforms: {}, vertexShader: "#include <begin_vertex>", fragmentShader: "#include <map_fragment>" } as THREE.WebGLProgramParametersWithUniforms;
  feather.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  assert.equal(shader.uniforms.featherAmount.value, 1);
  assert.ok(shader.uniforms.featherSeconds.value > 2.9);
  assert.match(shader.fragmentShader, /artworkReveal/);
  model.update(3000, 0, 0, 0); assert.equal(shader.uniforms.featherAmount.value, 0);
  init.dispose();
});

// 独立验证参考图的实际网格，防止只替换后备图而运行时仍绘制旧造型。
test("reference crown bends independent feathers without moving their roots", () => {
  const init = new Initialization();
  const textures = [0, 1, 2].map(() => init.track(new THREE.Texture()));
  const model = buildEntryArtwork("crown", textures, init);
  const feathers = model.root.children.filter(object => object.name.startsWith("artwork-feather")) as THREE.Mesh[];
  assert.equal(feathers.length, 2);
  const buffers = feathers.map(mesh => mesh.geometry.getAttribute("position"));
  model.update(0, 0, 0, 0);
  const rest = buffers.map(buffer => Array.from(buffer.array));
  // 找到每片羽根最近的实际顶点，检查变形不会把连接点从冠座顶部拉走。
  const roots = buffers.map((buffer, side) => {
    let nearest = 0, distance = Infinity;
    for (let i = 0; i < buffer.count; i++) {
      const current = (buffer.getX(i) - (side === 0 ? -3.8 : 3.8)) ** 2 + (buffer.getY(i) + 3.4) ** 2;
      if (current < distance) { nearest = i; distance = current; }
    }
    return nearest;
  });
  model.update(1673, 1, 0, 0);
  buffers.forEach((buffer, i) => {
    assert.equal(feathers[i].geometry.getAttribute("position"), buffer);
    assert.notDeepEqual(Array.from(buffer.array), rest[i]);
    assert.ok(Array.from(buffer.array).every(Number.isFinite));
    for (let axis = 0; axis < 3; axis++) {
      const index = roots[i] * 3 + axis;
      assert.equal(buffer.array[index], rest[i][index], "羽根顶点必须固定");
    }
  });
  // 长时间采样必须达到肉眼可辨的摆幅，同时保持既有缓冲和左右独立节奏。
  let peak = 0;
  for (let time = 0; time < 12000; time += 173) {
    model.update(time, 1, 0, 0);
    buffers.forEach((buffer, side) => {
      for (let i = 0; i < buffer.count; i++) {
        peak = Math.max(peak, Math.hypot(buffer.getX(i) - rest[side][i * 3], buffer.getY(i) - rest[side][i * 3 + 1]));
      }
    });
  }
  assert.ok(peak > 10 && peak < 30, `羽片最大摆幅应明显且受控：${peak}`);
  model.update(1673, 0, 0, 0);
  buffers.forEach((buffer, i) => assert.deepEqual(Array.from(buffer.array), rest[i]));
  init.dispose();
});

// 原时间参数继续控制整体转头、红眼和六条红丝；释放纹理与缓冲仍归同一个初始化域。
test("reference monkey preserves turn, red eyes, silk and texture disposal", () => {
  const init = new Initialization(), texture = init.track(new THREE.Texture());
  let released = 0;
  texture.addEventListener("dispose", () => released++);
  const model = buildEntryArtwork("monkey", [texture], init);
  model.update(0, 0, 0, 0);
  const rest = model.root.rotation.y;
  model.update(900, 1, 1, 1);
  assert.ok(model.root.rotation.y - rest > .4);
  const face = model.root.getObjectByName("artwork-monkey") as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  assert.equal(face.material.map, texture);
  assert.equal(face.material.userData.eye.value, 1);
  assert.ok(face.geometry.getAttribute("position").getZ(0) < 4);
  const silk = model.root.children.filter(object => object.name === "artwork-silk");
  assert.equal(silk.length, 6);
  assert.ok(silk.every(object => object.visible));
  const thread = silk[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const positions = thread.geometry.getAttribute("position");
  assert.ok(Math.abs(positions.getY(0) - positions.getY(1)) > 4.5, "红丝根部需有更清晰的细芯和柔光宽度");
  assert.ok(thread.material.uniforms.glow.value >= .6, "小尺寸红丝应保留可见柔光");
  model.update(1800, 1, 0, 0);
  assert.equal(model.root.rotation.y, rest);
  assert.ok(silk.every(object => !object.visible));
  init.dispose(); init.dispose();
  assert.equal(released, 1);
});

// 冠座与羽片共用复色进度和画布纵坐标；猴头红眼在复色混合之后叠加，不被原色覆盖。
test("artwork color reveal shares a horizontal screen boundary and preserves red eyes", () => {
  const init = new Initialization(), night = [0, 1, 2].map(() => init.track(new THREE.Texture()));
  const color = [0, 1, 2].map(() => init.track(new THREE.Texture()));
  const crown = buildEntryArtwork("crown", night, init, color);
  crown.setColorReveal?.(.5);
  let shared: unknown;
  for (const child of crown.root.children as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[]) {
    const shader = { uniforms: {}, fragmentShader: "#include <map_fragment>\n#include <color_fragment>" } as THREE.WebGLProgramParametersWithUniforms;
    child.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    assert.equal(shader.uniforms.artworkReveal.value, .5);
    if (shared) assert.equal(shader.uniforms.artworkReveal, shared);
    shared = shader.uniforms.artworkReveal;
    assert.match(shader.fragmentShader, /gl_FragCoord.y \/ artworkViewport.y/);
  }
  const monkey = buildEntryArtwork("monkey", [night[0]], init, [color[0]]);
  monkey.setColorReveal?.(1);
  const mesh = monkey.root.getObjectByName("artwork-monkey") as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  const shader = { uniforms: {}, fragmentShader: "#include <map_fragment>\n#include <color_fragment>" } as THREE.WebGLProgramParametersWithUniforms;
  mesh.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  assert.ok(shader.fragmentShader.indexOf("float eyeMask") > shader.fragmentShader.indexOf("float revealed"));
  init.dispose();
});
