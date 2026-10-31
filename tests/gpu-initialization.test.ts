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
  let task=0,cancel=false;
  const draws: THREE.Object3D[][]=[];
  const init=new Initialization(()=>0,async()=>{task++;if(cancel && task===4) init.dispose();});
  const renderer={shadowMap:{needsUpdate:false},async compileAsync() {}, render() {
    const active: THREE.Object3D[]=[];
    scene.traverseVisible(object=>{if(object instanceof THREE.Mesh && object.layers.test(camera.layers)) active.push(object);});
    assert.ok(light.visible);draws.push(active);
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
