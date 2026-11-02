import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Initialization } from "../src/scene/initialization.ts";
import { initializeTextures, warmScene, warmSceneBatched } from "../src/scene/gpu-initialization.ts";

// 驱动可以保持未完成，但编译提交本身也要按预算让出；不能等一个对象编完才提交下一个。
test("shader compilation yields its CPU budget while all driver requests remain pending", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  for (let i = 0; i < 6; i++) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  let time = 0, partialYields = 0;
  const compiled: THREE.Object3D[] = [];
  let finish!: () => void;
  const driver = new Promise<void>(resolve => { finish = resolve; });
  const viewport = new THREE.Vector4(0, 0, 800, 600);
  const renderer = { shadowMap: { needsUpdate: false },
    getViewport: (target: THREE.Vector4) => target.copy(viewport),
    setViewport(x: number | THREE.Vector4, y?: number, z?: number, w?: number) {
      if (x instanceof THREE.Vector4) viewport.copy(x); else viewport.set(x, y!, z!, w!);
    }, compileAsync(object: THREE.Object3D) { compiled.push(object); time += 5; return driver; }, render() {},
  } as unknown as THREE.WebGLRenderer;
  const init = new Initialization(() => time, async () => {
    if (compiled.length > 0 && compiled.length < 6) partialYields++;
  });
  const warming = warmSceneBatched(renderer, scene, camera, init);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(compiled, scene.children);
    assert.ok(partialYields > 0);
  } finally { finish(); await warming; init.dispose(); }
});

// 全部编译请求统一等待驱动；异常必须恢复实际视口与对象层，不能把小视口泄漏到主页。
test("parallel warmup compiles all branches and restores viewport after upload failure", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  for (let i = 0; i < 5; i++) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  const viewport = new THREE.Vector4(0, 0, 1366, 768);
  let compiles = 0, draws = 0, fail = false;
  const renderer = { shadowMap: { needsUpdate: false }, getViewport: (target: THREE.Vector4) => target.copy(viewport),
    setViewport(x: number | THREE.Vector4, y?: number, z?: number, w?: number) {
      if (x instanceof THREE.Vector4) viewport.copy(x); else viewport.set(x, y!, z!, w!);
    }, async compileAsync(object: THREE.Object3D, actualCamera: THREE.Camera, target: THREE.Scene) {
      assert.ok(scene.children.includes(object)); assert.equal(actualCamera, camera); assert.equal(target, scene); compiles++;
    },
    render() {
      assert.equal(viewport.z, 8);
      assert.ok(scene.children.filter(object => object.layers.mask).every(object => !object.frustumCulled));
      if (fail) throw new Error("upload failed"); draws++;
    },
  } as unknown as THREE.WebGLRenderer;
  const init = new Initialization(() => 0, async () => {});
  await warmSceneBatched(renderer, scene, camera, init);
  assert.equal(compiles, 5); assert.equal(draws, 5); assert.equal(viewport.z, 1366);
  fail = true; scene.children[0].position.x++;
  await assert.rejects(warmSceneBatched(renderer, scene, camera, init), /upload failed/);
  assert.equal(viewport.z, 1366); assert.ok(scene.children.every(object => object.layers.mask === 1));
  assert.ok(scene.children.every(object => object.frustumCulled));
  init.dispose();
});

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
  task=0;draws.length=0;cancel=true;parent.position.x=1;
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

// 只缓存成功提交的完整绘制状态；隐藏的新对象仍须预热，几何、材质、变换、灯光变化均失效。
test("GPU submission cache skips identical draws and invalidates all changed render inputs", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const hidden = mesh.clone(); hidden.visible = false; scene.add(mesh, hidden);
  const light = new THREE.PointLight(); scene.add(light);
  let draws = 0, fail = false;
  const init = new Initialization(() => 0, async () => {});
  const renderer = { shadowMap: { needsUpdate: false }, async compileAsync() {}, render() {
    if (fail) throw new Error("submission rejected"); draws++;
  } } as unknown as THREE.WebGLRenderer;
  await warmScene(renderer, scene, camera, init); assert.equal(draws, 1);
  await warmScene(renderer, scene, camera, init); assert.equal(draws, 1);
  for (const change of [
    () => { mesh.position.x++; },
    () => { mesh.geometry.getAttribute("position").needsUpdate = true; },
    () => { mesh.geometry.setAttribute("position", mesh.geometry.getAttribute("position").clone()); },
    () => { mesh.geometry.setDrawRange(0, 3); },
    () => { mesh.material.color.set(0xffddaa); },
    () => { mesh.material.needsUpdate = true; },
    () => { light.intensity++; },
    () => { light.position.y++; },
    () => { camera.position.z++; },
  ]) {
    const before = draws; change();
    await warmScene(renderer, scene, camera, init); assert.equal(draws, before + 1);
  }
  hidden.visible = true;
  await warmScene(renderer, scene, camera, init); assert.equal(draws, 11);
  mesh.position.z++; fail = true;
  await assert.rejects(warmScene(renderer, scene, camera, init), /submission rejected/);
  fail = false;
  await warmScene(renderer, scene, camera, init); assert.equal(draws, 12);
  init.dispose();
});

// 自定义 uniform、实例缓冲和阴影投影体变化不能沿用已提交缓存。
test("GPU cache invalidates uniforms, instances, depth materials and moved shadow casters", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const material = new THREE.ShaderMaterial({ uniforms: { strength: { value: 0 } } });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 1); scene.add(mesh);
  const init = new Initialization(() => 0, async () => {});
  let draws = 0;
  const renderer = { shadowMap: { needsUpdate: false }, async compileAsync() {}, render() { draws++; } } as unknown as THREE.WebGLRenderer;
  await warmScene(renderer, scene, camera, init);
  material.uniforms.strength.value++;
  await warmScene(renderer, scene, camera, init); assert.equal(draws, 2);
  mesh.instanceMatrix.needsUpdate = true;
  await warmScene(renderer, scene, camera, init); assert.equal(draws, 3);
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
  await warmScene(renderer, scene, camera, init); assert.equal(draws, 4);
  const caster = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  caster.castShadow = true; scene.add(caster);
  await warmScene(renderer, scene, camera, init); assert.equal(draws, 6);
  caster.position.y++;
  await warmScene(renderer, scene, camera, init); assert.equal(draws, 8);
  init.dispose();
});

// 外部闭包 uniform 无法从材质属性读取；保守提交，避免把未知状态当成完全相同的状态。
test("GPU cache never skips custom callbacks with unobservable external uniforms", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const material = new THREE.MeshStandardMaterial(), wind = { value: 0 };
  material.onBeforeCompile = shader => { shader.uniforms.wind = wind; };
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const init = new Initialization(() => 0, async () => {});
  let draws = 0;
  const renderer = { shadowMap: { needsUpdate: false }, async compileAsync() {}, render() { draws++; } } as unknown as THREE.WebGLRenderer;
  await warmScene(renderer, scene, camera, init);
  wind.value++;
  await warmScene(renderer, scene, camera, init);
  assert.equal(draws, 2);
  init.dispose();
});
