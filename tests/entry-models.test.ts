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

// 从合批后的实体测量宽短比例与耳朵外伸，避免造型参数正确而实际剪影仍然细长。
test("monkey has a broad short silhouette, rounded tufts and small ears", () => {
  const model=createMonkey();
  const points: THREE.Vector3[]=[];
  model.root.traverse(object=>{
    if(!(object instanceof THREE.Mesh) || object.material instanceof THREE.ShaderMaterial) return;
    const position=object.geometry.getAttribute("position");
    for(let i=0;i<position.count;i++) points.push(new THREE.Vector3().fromBufferAttribute(position,i));
  });
  const bounds=new THREE.Box3().setFromPoints(points);
  const width=bounds.max.x-bounds.min.x,height=bounds.max.y-bounds.min.y;
  assert.ok(width/height>.87 && width/height<.95,"整头宽高比应接近 0.9");
  const hair=model.root.children.find(object=>object instanceof THREE.Mesh && !Array.isArray(object.material)
    && object.material.name==="monkey-hair") as THREE.Mesh;
  const hairBox=new THREE.Box3().setFromBufferAttribute(hair.geometry.getAttribute("position") as THREE.BufferAttribute);
  assert.ok((width-(hairBox.max.x-hairBox.min.x))/2/width<.08,"每侧耳轮突出不超过头宽的 8%");
  const crown=points.filter(p=>p.y>20);
  const top=Math.max(...crown.map(p=>p.y));
  const broadTop=crown.filter(p=>Math.abs(p.x)>6 && p.y>top-3);
  assert.ok(broadTop.length>30,"中央主束两侧必须保留圆润宽发束");
  assert.ok(top<27,"发顶不能继续保留高耸尖刺");
  assert.ok(hair.geometry.getAttribute("position").count<40000,"毛发与眉毛合批必须遵守静态网格预算");
  disposeModel(model.root);
});

// 连续桃形脸面直接约束低额头、宽下巴与短鼻；眉眼的实际体积必须在小图标中可读。
test("monkey has a low peach frame, broad jaw and large eyes under sloped brows", () => {
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
  const faceBox=new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
  assert.ok(faceBox.max.x-faceBox.min.x>30,"面部应拓宽到饱满的短脸");
  assert.ok(faceBox.max.y<13 && faceBox.min.y< -20,"桃形面框应压低额头并保留宽圆下巴");
  const span=(y: number)=>{
    const xs=[];
    for(let i=0;i<position.count;i++) if(Math.abs(position.getY(i)-y)<.6) xs.push(Math.abs(position.getX(i)));
    return Math.max(...xs);
  };
  assert.ok(span(-15)>span(-2)*.77,"下半脸不能再收成狭长尖下巴");
  assert.ok(near(0,7)>4,"额头中轴必须连续，不能形成两块独立凸球");
  assert.ok(near(7,0)<near(7,-5),"眼窝应低于颧骨，眉眼靠真实凹凸呈现");
  const hair=mesh("monkey-hair").geometry.getAttribute("position");
  let lowForelock=false;
  for(let i=0;i<hair.count;i++) if(Math.abs(hair.getX(i))<1 && hair.getY(i)>6 && hair.getY(i)<9 && hair.getZ(i)>5)
    lowForelock=true;
  assert.ok(lowForelock,"中央发尖应压低到额前，避免后移发际线");
  const eyes=mesh("monkey-eye");
  assert.ok(eyes,"大眼面应保留独立可变色材质");
  const eyeBox=new THREE.Box3().setFromBufferAttribute(eyes.geometry.getAttribute("position") as THREE.BufferAttribute);
  assert.ok(eyeBox.max.y-eyeBox.min.y>5,"眼面必须为大眼形，不能退回细长眯眼");
  assert.ok(Math.abs(model.root.rotation.y)<=.1,"保持接近正面的阅读方向");
  // 每条实体边恰好由两片三角面共用，防止细分回归为有裂口的独立三角面。
  const indices=face.geometry.index!.array,edges=new Map<string,number>();
  for(let i=0;i<indices.length;i+=3) for(let j=0;j<3;j++) {
    const a=indices[i+j],b=indices[i+(j+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;
    edges.set(key,(edges.get(key)??0)+1);
  }
  assert.ok([...edges.values()].every(count=>count===2),"连续脸面必须为闭合实体，不能留下 T 形边界");
  assert.ok(Array.from(face.geometry.getAttribute("normal").array).every(Number.isFinite),"脸面法线必须有效");
  disposeModel(model.root);
});
