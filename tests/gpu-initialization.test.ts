import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Initialization } from "../src/scene/initialization.ts";
import { initializeTextures, warmScene } from "../src/scene/gpu-initialization.ts";

// 使用真实场景树验证纹理去重、隐藏资源和实际绘制之间确实经过任务调度。
test("GPU initialization uploads shared and hidden textures in separate tasks", async () => {
  const scene=new THREE.Scene(),map=new THREE.Texture(),hiddenMap=new THREE.Texture();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({map})),
    new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({map})));
  const hidden=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({map:hiddenMap}));
  hidden.visible=false;scene.add(hidden);
  let task=0;
  const uploads: number[]=[],textures: THREE.Texture[]=[];
  const init=new Initialization(()=>0,async()=>{task++;});
  await initializeTextures({initTexture(texture: THREE.Texture) {textures.push(texture);uploads.push(task);}} as THREE.WebGLRenderer,scene,init);
  assert.deepEqual(textures,[map,hiddenMap]);
  assert.equal(new Set(uploads).size,2);
});

// 真实绘制保持场景灯光组合；取消排队任务后必须恢复对象状态，禁止再提交。
test("GPU warmup draws objects separately and restores state on cancellation", async () => {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const parent=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
  const child=new THREE.Mesh(new THREE.BoxGeometry(),parent.material);parent.add(child);scene.add(parent);
  const hidden=parent.clone();hidden.visible=false;scene.add(hidden);
  const light=new THREE.PointLight();scene.add(light);
  let task=0,cancel=false,time=0;
  const draws: THREE.Object3D[][]=[];
  const init=new Initialization(()=>time,async()=>{task++;if(cancel && task===2) init.dispose();});
  const renderer={shadowMap:{needsUpdate:false},async compileAsync() {}, render() {
    const active: THREE.Object3D[]=[];
    scene.traverseVisible(object=>{if(object instanceof THREE.Mesh && object.layers.test(camera.layers)) active.push(object);});
    assert.ok(light.visible);draws.push(active);time+=8;
  }} as unknown as THREE.WebGLRenderer;
  await warmScene(renderer,scene,camera,init);
  assert.deepEqual(draws,[[parent],[child]]);
  assert.ok(parent.visible && child.visible && !hidden.visible);
  assert.equal(parent.layers.mask,1);assert.equal(child.layers.mask,1);
  task=0;draws.length=0;cancel=true;
  await assert.rejects(warmScene(renderer,scene,camera,init),{name:"AbortError"});
  assert.equal(draws.length,1);
  assert.ok(parent.visible && child.visible && !hidden.visible);
  assert.equal(parent.layers.mask,1);assert.equal(child.layers.mask,1);
});

// 廉价对象共享一个约 8ms 的任务批次，不再为每个对象固定排队三次；非投影物体也不反复清理阴影。
test("GPU warmup batches cheap submissions and refreshes shadows only for casters", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  for (let i = 0; i < 8; i++) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  scene.children[4].castShadow = true;
  let time = 0, schedules = 0, compiles = 0;
  const shadowUpdates: boolean[] = [];
  const init = new Initialization(() => time, async () => { schedules++; });
  const renderer = { shadowMap: { needsUpdate: false }, async compileAsync() { compiles++; time++; },
    render() { shadowUpdates.push(this.shadowMap.needsUpdate); this.shadowMap.needsUpdate = false; time++; },
  } as unknown as THREE.WebGLRenderer;
  await warmScene(renderer, scene, camera, init);
  assert.equal(compiles, 8);
  assert.ok(schedules <= 4, `cheap objects scheduled ${schedules} tasks`);
  assert.deepEqual(shadowUpdates, [true, false, false, false, true, false, false, false]);
  assert.equal(renderer.shadowMap.needsUpdate, true);
});

// 缓存仅归当前初始化、渲染器、场景和相机；灯光、材质版本改变时仍要编译新的组合。
test("GPU warmup reuses completed subtree combinations but invalidates changed materials and lighting", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const parent = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  parent.add(child); scene.add(parent);
  const light = new THREE.PointLight(); scene.add(light);
  let compiles = 0;
  const init = new Initialization(() => 0, async () => {});
  const renderer = { shadowMap: { needsUpdate: false }, async compileAsync() { compiles++; }, render() {},
  } as unknown as THREE.WebGLRenderer;
  await warmScene(renderer, scene, camera, init);
  assert.equal(compiles, 1);
  await warmScene(renderer, scene, camera, init);
  assert.equal(compiles, 1);
  child.material.needsUpdate = true;
  await warmScene(renderer, scene, camera, init);
  assert.equal(compiles, 2);
  light.visible = false;
  await warmScene(renderer, scene, camera, init);
  assert.equal(compiles, 3);
  const otherRenderer = { ...renderer } as THREE.WebGLRenderer;
  await warmScene(otherRenderer, scene, camera, init);
  assert.equal(compiles, 4);
});

// 编译仍可能异步等待驱动；取消须即时拒绝，迟到完成不能再绘制或污染下一轮缓存。
test("GPU warmup restores layers when cancelled during asynchronous compilation", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); scene.add(mesh);
  const init = new Initialization(() => 0, async () => {});
  let resolve!: () => void, draws = 0;
  let started!: () => void;
  const compilationStarted = new Promise<void>(done => { started = done; });
  const renderer = { shadowMap: { needsUpdate: false }, compileAsync() {
    started();
    return new Promise<void>(done => { resolve = done; });
  }, render() { draws++; } } as unknown as THREE.WebGLRenderer;
  const pending = warmScene(renderer, scene, camera, init);
  await compilationStarted;
  init.dispose();
  await assert.rejects(pending, { name: "AbortError" });
  resolve(); await Promise.resolve();
  assert.equal(mesh.layers.mask, 1);
  assert.equal(draws, 0);
  assert.equal(renderer.shadowMap.needsUpdate, true);
});
