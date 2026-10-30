import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCrown, createMonkey, disposeModel } from "../src/entry-models.ts";

// 实际模型验证缓冲身份和羽根，防止纯时间函数正确、渲染网格却重建或整体摇摆。
test("model animation reuses geometry and fixes every feather root", () => {
  const model=createCrown();
  const meshes=model.root.children.filter(object=>object instanceof THREE.Mesh);
  assert.ok(meshes.length<=8,"冠体静态雕刻应按材质合批");
  model.update(0,0,0,0);
  const dynamic=meshes.filter(mesh=>mesh.geometry.getAttribute("position").usage===THREE.DynamicDrawUsage);
  assert.equal(dynamic.length,4);
  const snapshots=dynamic.map(mesh=>({mesh,geometry:mesh.geometry,array:mesh.geometry.getAttribute("position").array,
    root:Array.from(mesh.geometry.getAttribute("position").array.slice(0,24)),tip:Array.from(mesh.geometry.getAttribute("position").array.slice(-24))}));
  model.update(5731,1,0,0);
  assert.equal(model.root.rotation.y,-.1);
  for(const {mesh,geometry,array,root,tip} of snapshots) {
    assert.equal(mesh.geometry,geometry);
    assert.equal(mesh.geometry.getAttribute("position").array,array);
    assert.deepEqual(Array.from(array.slice(0,24)),root);
    assert.notDeepEqual(Array.from(array.slice(-24)),tip);
    assert.ok(Array.from(array).every(Number.isFinite));
  }
  disposeModel(model.root);
});

// 丝带复用六个三角带，并检查真实模型的包围范围及全部 GPU 资源的释放事件。
test("monkey silk is bounded, batched and disposed exactly once", () => {
  const model=createMonkey();
  const meshes=model.root.children.filter(object=>object instanceof THREE.Mesh);
  assert.ok(meshes.length<=12,"猴头静态雕刻应按材质合批");
  const silk=meshes.filter(mesh=>mesh.material instanceof THREE.ShaderMaterial);
  assert.equal(silk.length,6);
  const buffers=silk.map(mesh=>mesh.geometry.getAttribute("position").array);
  for(let time=0;time<16000;time+=307) {
    model.update(time,1,1,1);
    silk.forEach((mesh,index)=>{
      const attr=mesh.geometry.getAttribute("position");
      assert.equal(attr.array,buffers[index]);
      for(let i=0;i<attr.count;i++) {
        assert.ok(Math.abs(attr.getX(i))<=26);
        assert.ok(attr.getY(i)<=13 && attr.getY(i)>=-1.5);
      }
    });
  }
  model.update(16000,0,0,0);
  assert.ok(silk.every(mesh=>!mesh.visible));
  const geometries=new Set(meshes.map(mesh=>mesh.geometry));
  const materials=new Set(meshes.flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]));
  let released=0;
  [...geometries,...materials].forEach(resource=>resource.addEventListener("dispose",()=>released++));
  disposeModel(model.root);
  assert.equal(released,geometries.size+materials.size);
  assert.equal(model.root.children.length,0);
});

// 从最终合批网格测量耳宽和发顶轮廓，约束小尺寸剪影而不是仅检查创建参数。
test("monkey has a rounded swept hair outline and restrained ears", () => {
  const model=createMonkey();
  const points: THREE.Vector3[]=[];
  model.root.traverse(object=>{
    if(!(object instanceof THREE.Mesh) || object.material instanceof THREE.ShaderMaterial) return;
    const position=object.geometry.getAttribute("position");
    for(let i=0;i<position.count;i++) points.push(new THREE.Vector3().fromBufferAttribute(position,i));
  });
  assert.ok(Math.max(...points.map(p=>Math.abs(p.x)))<24,"耳朵应收进头部轮廓两侧");
  const crown=points.filter(p=>p.y>20);
  const top=Math.max(...crown.map(p=>p.y));
  const broadTop=crown.filter(p=>Math.abs(p.x)>6 && p.y>top-3);
  assert.ok(broadTop.length>30,"发顶应是连续饱满曲面，而不是中央尖刺");
  assert.ok(top<27,"发顶不能继续保留高耸尖刺");
  disposeModel(model.root);
});

// 连续脸面避免分离的额头球；直接检查中轴、凹进的眼窝以及低垂额前的发尖。
test("monkey has a continuous face, recessed eyes and a low framed hairline", () => {
  const model=createMonkey();
  const mesh=(name: string)=>model.root.children.find(object=>object instanceof THREE.Mesh
    && !Array.isArray(object.material) && object.material.name===name) as THREE.Mesh;
  const face=mesh("monkey-face");
  assert.ok(face,"面部应采用独立的连续雕塑曲面");
  const position=face.geometry.getAttribute("position");
  const near=(x: number,y: number)=>{
    const candidates=[];
    for(let i=0;i<position.count;i++) if(Math.abs(position.getX(i)-x)<1.1 && Math.abs(position.getY(i)-y)<1.1)
      candidates.push(position.getZ(i));
    return Math.max(...candidates);
  };
  assert.ok(near(0,7)>4,"额头中轴必须连续，不能形成两块独立凸球");
  assert.ok(near(7,0)<near(7,-5),"眼窝应低于颧骨，眉眼靠真实凹凸呈现");
  const hair=mesh("monkey-hair").geometry.getAttribute("position");
  let lowForelock=false;
  for(let i=0;i<hair.count;i++) if(Math.abs(hair.getX(i))<1 && hair.getY(i)>8 && hair.getY(i)<12 && hair.getZ(i)>5)
    lowForelock=true;
  assert.ok(lowForelock,"中央发尖应压低到额前，避免后移发际线");
  disposeModel(model.root);
});
