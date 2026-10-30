import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { featherSection, silkPoint } from "./entry-motion.ts";

export interface EntryModel {
  root: THREE.Group;
  update(time: number, amount: number, eye: number, silk: number): void;
}

/** 小图标把同材质静态雕刻合批；动态羽片、丝线保留自己的可更新缓冲。 */
function batchRelief(root: THREE.Group) {
  const groups=new Map<THREE.Material,THREE.Mesh[]>();
  for(const object of root.children) {
    if(!(object instanceof THREE.Mesh) || Array.isArray(object.material)
      || object.geometry.getAttribute("position").usage===THREE.DynamicDrawUsage) continue;
    const group=groups.get(object.material) ?? [];
    group.push(object);groups.set(object.material,group);
  }
  for(const [material,meshes] of groups) {
    if(meshes.length<2) continue;
    const sources=meshes.map(mesh=>{
      mesh.updateMatrix();
      const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
      return geometry.applyMatrix4(mesh.matrix);
    });
    const merged=mergeGeometries(sources);
    sources.forEach(geometry=>geometry.dispose());
    if(!merged) throw new Error("入口雕刻合批失败：静态几何体属性不一致");
    for(const mesh of meshes) {root.remove(mesh);mesh.geometry.dispose();}
    root.add(new THREE.Mesh(merged,material));
  }
}

/** 有倒角的实体轮廓负责厚度；颜色只用于材质，不用平面贴图伪装模型。 */
function relief(points: number[][], depth: number, material: THREE.Material, z = 0) {
  const shape = new THREE.Shape();
  points.forEach(([x,y], i) => i ? shape.lineTo(x,y) : shape.moveTo(x,y));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .5, bevelThickness: .45,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  return mesh;
}

/** 用独立凸面和刻槽塑造眉骨、鼻梁、耳轮，灯光在这些真实曲面上形成明暗。 */
function oval(root: THREE.Group, material: THREE.Material, position: number[], scale: number[]) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), material);
  mesh.position.set(position[0],position[1],position[2]);
  mesh.scale.set(scale[0],scale[1],scale[2]);
  root.add(mesh);
  return mesh;
}

function ridge(root: THREE.Group, material: THREE.Material, points: number[][], radius: number) {
  const curve = new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[0],p[1],p[2])));
  root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, radius, 6, false),material));
}

/** 连续贝塞尔轮廓用于顺滑毛发和眉弓，保留倒角厚度而不产生三角刺状剪影。 */
function smoothRelief(shape: THREE.Shape, depth: number, material: THREE.Material, z: number, bevel = .55) {
  const geometry=new THREE.ExtrudeGeometry(shape,{
    depth,curveSegments:24,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:bevel,bevelThickness:bevel,
  });
  const mesh=new THREE.Mesh(geometry,material);
  mesh.position.z=z;
  return mesh;
}

/** 羽片和羽轴共用环截面网格；每帧只更新原来的缓冲，不创建几何体或材质。 */
function plume(root: THREE.Group, material: THREE.Material, shaftMaterial: THREE.Material, side: number) {
  const sections = 32, ring = 8;
  const make = () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((sections+1)*ring*3),3).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    for(let i=0;i<sections;i++) for(let j=0;j<ring;j++) {
      const a=i*ring+j,b=i*ring+(j+1)%ring,c=a+ring,d=b+ring;
      indices.push(a,b,c,b,d,c);
    }
    geometry.setIndex(indices);
    return geometry;
  };
  const blade=make(), shaft=make();
  const feather = new THREE.Mesh(blade,material), stem = new THREE.Mesh(shaft,shaftMaterial);
  // 中心线、法向和两个截面缓冲都预先分配；弯曲后截面跟随局部切线转向。
  const centers=new Float64Array((sections+1)*6);
  const bladePosition=blade.getAttribute("position") as THREE.BufferAttribute;
  const shaftPosition=shaft.getAttribute("position") as THREE.BufferAttribute;
  // 模型整体固定；只有羽片的纵向权重允许根部以上产生弯曲和扭转。
  feather.frustumCulled = stem.frustumCulled = false;
  root.add(feather,stem);
  return (time: number, amount: number) => {
    for(let i=0;i<=sections;i++) {
      const p=featherSection(i/sections,time,side,amount),at=i*6;
      centers[at]=p.x;centers[at+1]=p.y;centers[at+2]=p.z;
      centers[at+3]=p.width;centers[at+4]=p.shaft;centers[at+5]=p.twist;
    }
    for(let i=0;i<=sections;i++) {
      const at=i*6,before=Math.max(0,i-1)*6,after=Math.min(sections,i+1)*6;
      // 根截面也锁定静止切线，避免邻点的轻微弯曲传回根环而破坏固定连接。
      const dx=i===0?side*(23+3*Math.PI):centers[after]-centers[before];
      const dy=i===0?74:centers[after+1]-centers[before+1];
      const length=Math.hypot(dx,dy),nx=dy/length,ny=-dx/length;
      const cos=Math.cos(centers[at+5]),sin=Math.sin(centers[at+5]);
      for(let j=0;j<ring;j++) {
        const angle=j/ring*Math.PI*2, across=Math.cos(angle), deep=Math.sin(angle);
        const index=(i*ring+j)*3;
        const offset=across*centers[at+3],shaftOffset=across*centers[at+4];
        const thickness=.02+.22*(1-i/sections);
        bladePosition.array[index]=centers[at]+nx*offset*cos;
        bladePosition.array[index+1]=centers[at+1]+ny*offset*cos;
        bladePosition.array[index+2]=centers[at+2]+deep*thickness+offset*sin;
        shaftPosition.array[index]=centers[at]+nx*shaftOffset*cos;
        shaftPosition.array[index+1]=centers[at+1]+ny*shaftOffset*cos;
        shaftPosition.array[index+2]=centers[at+2]+thickness+deep*centers[at+4]+shaftOffset*sin;
      }
    }
    for(const geometry of [blade,shaft]) {
      geometry.getAttribute("position").needsUpdate=true;
      geometry.computeVertexNormals();
    }
  };
}

export function createCrown(): EntryModel {
  const root=new THREE.Group();
  const gold=new THREE.MeshStandardMaterial({color:0xc6a159,metalness:.68,roughness:.29});
  const rim=new THREE.MeshStandardMaterial({color:0xe8cb88,metalness:.58,roughness:.25});
  const purple=new THREE.MeshStandardMaterial({color:0x633665,metalness:.35,roughness:.34});
  const feather=new THREE.MeshStandardMaterial({color:0xb89958,metalness:.42,roughness:.43,side:THREE.DoubleSide});
  const plumes=[plume(root,feather,rim,-1),plume(root,feather,rim,1)];
  root.add(relief([[-19,-10],[-14,-6],[-9,-11],[-6,-2],[0,3],[6,-2],[9,-11],[14,-6],[19,-10],[16,-23],[0,-27],[-16,-23]],3,gold,2));
  root.add(relief([[-10,-14],[-6,-6],[0,-1],[6,-6],[10,-14],[7,-22],[0,-24],[-7,-22]],1.7,purple,5.3));
  root.add(relief([[0,-5],[4,-12],[0,-18],[-4,-12]],1.4,rim,7.5));
  ridge(root,rim,[[-17,-19,6],[-9,-22,7],[0,-23,7.5],[9,-22,7],[17,-19,6]],.68);
  ridge(root,gold,[[-15,-24,5],[0,-27,6],[15,-24,5]],.7);
  for(const side of [-1,1]) {
    ridge(root,rim,[[side*16,-10,5.5],[side*13,-14,6],[side*12,-18,6]],.55);
    ridge(root,rim,[[side*7,-6,6],[side*5,-10,7]],.45);
  }
  batchRelief(root);
  root.rotation.y=-.1;
  return {root,update(time,amount) {plumes.forEach(update=>update(time,amount));}};
}

/** 丝带用一次分配的动态三角带；横向高斯分布同时保留细芯和柔光，无额外后处理画布。 */
function redSilk(root: THREE.Group, side: number, strand: number) {
  const segments=36, positions=new Float32Array((segments+1)*2*3), uv=new Float32Array((segments+1)*2*2);
  const geometry=new THREE.BufferGeometry(), indices: number[]=[];
  for(let i=0;i<=segments;i++) for(let j=0;j<2;j++) {
    const at=i*2+j;
    uv[at*2]=j; uv[at*2+1]=i/segments;
    if(i<segments && j===0) indices.push(at,at+1,at+2,at+1,at+3,at+2);
  }
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv",new THREE.BufferAttribute(uv,2));
  geometry.setIndex(indices);
  const material=new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, depthTest:false, side:THREE.DoubleSide, toneMapped:false,
    uniforms:{strength:{value:0}},
    vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec2 vUv; uniform float strength;
      void main(){float d=(vUv.x-.5)*2.;float core=exp(-d*d*75.);float glow=exp(-d*d*4.)*.32;
      float tail=pow(1.-vUv.y,.6);gl_FragColor=vec4(vec3(1.,.075+core*.22,.055+core*.11), (core+glow)*tail*strength);}`,
  });
  const mesh=new THREE.Mesh(geometry,material);
  mesh.frustumCulled=false; mesh.renderOrder=10;
  root.add(mesh);
  return (time: number, extension: number) => {
    mesh.visible=extension>0;
    material.uniforms.strength.value=Math.min(1,extension*4);
    if(!mesh.visible) return;
    for(let i=0;i<=segments;i++) {
      const t=i/segments,p=silkPoint(t,time,side,strand,extension);
      // 收敛时长度和透明度一起衰减；根点不挪动，尾端的宽度精确减到零。
      const width=p.width*5;
      for(let j=0;j<2;j++) {
        const at=(i*2+j)*3;
        positions[at]=p.x;positions[at+1]=p.y+(j?1:-1)*width;positions[at+2]=p.z+3;
      }
    }
    geometry.getAttribute("position").needsUpdate=true;
  };
}

/** 连续面部雕出鼻梁、眼窝与颧骨，避免拼球造成两块肿胀额头。 */
function monkeyFace(material: THREE.Material) {
  const geometry=new THREE.SphereGeometry(1,64,56);
  const position=geometry.getAttribute("position");
  const bump=(x: number,y: number,cx: number,cy: number,wx: number,wy: number)=>
    Math.exp(-(((x-cx)/wx)**2)-((y-cy)/wy)**2);
  for(let i=0;i<position.count;i++) {
    const sy=position.getY(i),sz=position.getZ(i),y=sy*22;
    const jaw=1-.22*Math.max(0,Math.min(1,(-y-5)/15));
    const x=position.getX(i)*15.3*jaw;
    let z=sz*5.8;
    if(sz>0) {
      // 额头保持平整；细鼻梁自然抬起，眼窝凹进颧骨，口部只保留克制的体积。
      z+=Math.min(1,sz*5)*(3.5*bump(x,y,0,-4,2.1,8)
        +2*bump(x,y,0,-7,3,2.2)+.8*bump(x,y,0,-12,5,3.5)
        +.8*bump(x,y,0,8,9,9)
        +.9*(bump(x,y,8,-5,4,3)+bump(x,y,-8,-5,4,3))
        -1.4*(bump(x,y,7,0,4.6,2.6)+bump(x,y,-7,0,4.6,2.6)));
    }
    position.setXYZ(i,x,y,z);
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry,material);
}

/** 毛发整圈弧面：中央低发尖与两侧鬓毛框住脸，前后曲面共同保留实体厚度。 */
function monkeyHair(material: THREE.Material) {
  const outer=[[0,25.5],[9,25],[16.5,20],[19,10],[18.5,-1],[16,-12],[9,-22],[0,-25],
    [-9,-22],[-16,-12],[-18.5,-1],[-19,10],[-16.5,20],[-9,25]];
  const inner=[[0,10.5],[6,15],[10.8,12.5],[12.7,6],[11,-2],[7.8,-9],[6.8,-17],[0,-20.7],
    [-6.8,-17],[-7.8,-9],[-11,-2],[-12.7,6],[-10.8,12.5],[-6,15]];
  const curve=(points: number[][])=>new THREE.CatmullRomCurve3(points.map(([x,y])=>new THREE.Vector3(x,y,0)),true,"centripetal");
  // 小尺寸使用固定细分预算；顺毛细节只在初始化创建，交互不更新这部分几何体。
  const outside=curve(outer),inside=curve(inner),steps=360,rings=20;
  const positions=[],indices=[];
  for(let i=0;i<=steps;i++) {
    // 两颊发束向外下方梳，避免环形横纹像头套；顶端与下巴的接缝保持连续。
    const u=i/steps,shift=Math.sin(u*Math.PI*2)*.045;
    const a=inside.getPoint(u),b=outside.getPoint((u+shift+1)%1);
    for(let j=0;j<=rings;j++) {
      const t=j/rings,x=THREE.MathUtils.lerp(a.x,b.x,t),y=THREE.MathUtils.lerp(a.y,b.y,t);
      // 毛流直接雕进表面，并沿弧面轻微偏转；不叠加悬空黑线，也不把剪影做成尖刺。
      const flow=i/steps*Math.PI*2*72+t*2.4;
      const strands=(Math.cos(flow)*.13+Math.cos(flow*2+.3)*.025)*Math.sin(Math.PI*t)**.45;
      positions.push(x,y,5.5+Math.sin(Math.PI*t)*1.5-4.7*t*t+strands);
      if(i<steps && j<rings) {
        const k=i*(rings+1)+j;
        indices.push(k,k+1,k+rings+1,k+1,k+rings+2,k+rings+1);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  // 与后脑球面的属性保持一致，静态合批后仍只需一个毛发绘制调用。
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return new THREE.Mesh(geometry,material);
}

export function createMonkey(): EntryModel {
  const root=new THREE.Group();
  const bronze=new THREE.MeshStandardMaterial({color:0x57422c,metalness:.5,roughness:.52});
  const hairMetal=new THREE.MeshStandardMaterial({color:0x665039,metalness:.42,roughness:.64,side:THREE.DoubleSide});
  const face=new THREE.MeshStandardMaterial({color:0x98784f,metalness:.4,roughness:.53});
  const highlight=new THREE.MeshStandardMaterial({color:0xad9162,metalness:.48,roughness:.4});
  const shadow=new THREE.MeshStandardMaterial({color:0x211a14,metalness:.3,roughness:.65});
  const eye=new THREE.MeshStandardMaterial({color:0x927346,metalness:.4,roughness:.3,emissive:0xff0802,emissiveIntensity:0});
  // 参考影视角色的桃形面框与向后梳的额毛；保留暗金雕塑语言，不添加金箍。
  face.name="monkey-face";hairMetal.name="monkey-hair";
  root.add(monkeyFace(face),monkeyHair(hairMetal));
  oval(root,hairMetal,[0,1,-1.5],[17.5,23.5,4]);
  for(const side of [-1,1]) {
    // 小耳轮藏在颞部后侧，减少黑色耳洞的面积，给外眼角的红丝留出清晰背景。
    oval(root,bronze,[side*18.4,-1,0],[2.7,4.5,2]);
    oval(root,shadow,[side*19.1,-1,1.8],[.8,2.4,.5]);
    // 眼窝位于眉骨下面；深色沟槽及窄眼面让暗金小尺寸也能读出凝视方向。
    const socket=new THREE.Shape();
    socket.moveTo(side*3.3,-.4);
    socket.bezierCurveTo(side*6,1,side*9.5,1.4,side*12.4,.4);
    socket.quadraticCurveTo(side*10,-2.6,side*7.2,-2.1);
    socket.quadraticCurveTo(side*5,-1.8,side*3.3,-.4);
    root.add(smoothRelief(socket,.25,shadow,5.8,.18));
    const lens=new THREE.Shape();
    lens.moveTo(side*4.2,-.5);
    lens.quadraticCurveTo(side*7.7,.65,side*11.5,.15);
    lens.quadraticCurveTo(side*8.4,-1.9,side*6.5,-1.15);
    lens.quadraticCurveTo(side*5,-1,side*4.2,-.5);
    root.add(smoothRelief(lens,.12,eye,6.2,.08));
    oval(root,shadow,[side*7.6,-.5,7],[.62,.8,.22]);
    // 薄弧面形成上扬眉峰，避免粗圆管眉毛像护目镜；眉头收拢以保留英气。
    const brow=new THREE.Shape();
    brow.moveTo(side*2.9,2.1);
    brow.quadraticCurveTo(side*7.6,5.2,side*12.7,3.5);
    brow.quadraticCurveTo(side*10.2,3.1,side*7.4,3.1);
    brow.quadraticCurveTo(side*4.6,2,side*2.9,2.1);
    root.add(smoothRelief(brow,.28,bronze,6.5,.12));
  }
  // 鼻翼和唇缝只刻少量细节，嘴角轻扬；去掉旧版外突的口鼻球与下巴饰线。
  for(const side of [-1,1]) oval(root,shadow,[side*1.45,-8.1,9.2],[.55,.3,.2]);
  ridge(root,shadow,[[-4.8,-12.4,5.9],[-2,-13.3,6.5],[0,-13,6.7],[2,-13.3,6.5],[4.8,-12.4,5.9]],.18);
  ridge(root,highlight,[[-2.8,-14.6,6],[0,-14.9,6.4],[2.8,-14.6,6]],.16);
  const silk=[-1,1].flatMap(side=>[0,1,2].map(strand=>redSilk(root,side,strand)));
  const resting=new THREE.Color(0x927346),red=new THREE.Color(0xa90603);
  batchRelief(root);
  root.rotation.y=-.1;
  return {root,update(time,_amount,eyes,threads) {
    eye.color.copy(resting).lerp(red,eyes);
    eye.emissiveIntensity=eyes*1.1;
    silk.forEach(update=>update(time,threads));
  }};
}

/** 场景、半成品及正常离页共用资源释放，材质共享时只销毁一次。 */
export function disposeModel(root: THREE.Object3D) {
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  root.traverse(object=>{
    if(object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      (Array.isArray(object.material)?object.material:[object.material]).forEach(material=>materials.add(material));
    }
  });
  geometries.forEach(geometry=>geometry.dispose());
  materials.forEach(material=>material.dispose());
  root.clear();
}
