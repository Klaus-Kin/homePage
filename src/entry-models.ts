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
function smoothRelief(shape: THREE.Shape, depth: number, material: THREE.Material, z: number) {
  const geometry=new THREE.ExtrudeGeometry(shape,{
    depth,curveSegments:24,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.55,bevelThickness:.55,
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

export function createMonkey(): EntryModel {
  const root=new THREE.Group();
  const bronze=new THREE.MeshStandardMaterial({color:0x57422c,metalness:.5,roughness:.52});
  const hairMetal=new THREE.MeshStandardMaterial({color:0x30291f,metalness:.42,roughness:.56});
  const face=new THREE.MeshStandardMaterial({color:0x997b50,metalness:.45,roughness:.48});
  const highlight=new THREE.MeshStandardMaterial({color:0xad9162,metalness:.48,roughness:.4});
  const shadow=new THREE.MeshStandardMaterial({color:0x211a14,metalness:.3,roughness:.65});
  const eye=new THREE.MeshStandardMaterial({color:0x927346,metalness:.4,roughness:.3,emissive:0xff0802,emissiveIntensity:0});
  // 无金箍轮廓：圆润发顶和顺着颞部下梳的鬃毛形成连续曲面，不再用尖刺表达毛发。
  const hair=new THREE.Shape();
  hair.moveTo(0,25.5);
  hair.bezierCurveTo(-10,25.8,-18,22,-19.2,13);
  hair.bezierCurveTo(-20.5,6,-18.8,1,-18.4,-5);
  hair.bezierCurveTo(-18.4,-13,-13.5,-19.5,-7,-23);
  hair.bezierCurveTo(-4,-25.5,-2,-26,0,-26);
  hair.bezierCurveTo(2,-26,4,-25.5,7,-23);
  hair.bezierCurveTo(13.5,-19.5,18.4,-13,18.4,-5);
  hair.bezierCurveTo(18.8,1,20.5,6,19.2,13);
  hair.bezierCurveTo(18,22,10,25.8,0,25.5);
  root.add(smoothRelief(hair,3.5,hairMetal,-1));
  oval(root,hairMetal,[0,1,1],[17,23,5]);
  for(const side of [-1,1]) {
    // 小耳轮藏在颞部后侧，减少黑色耳洞的面积，给外眼角的红丝留出清晰背景。
    oval(root,bronze,[side*19.7,.5,.7],[3.6,5.7,2.6]);
    oval(root,shadow,[side*20.8,.4,3],[1.4,3.4,.65]);
    oval(root,face,[side*20.5,-.3,3.6],[.8,2.3,.6]);
    oval(root,face,[side*7.3,0,4],[7.1,16.5,4]);
    // 眼窝位于眉骨下面；深色沟槽及窄眼面让暗金小尺寸也能读出凝视方向。
    const socket=new THREE.Shape();
    socket.moveTo(side*3,.2);
    socket.bezierCurveTo(side*6,1.2,side*10,3,side*13.5,2.4);
    socket.quadraticCurveTo(side*14,-.6,side*11,-2.5);
    socket.quadraticCurveTo(side*7,-4,side*3,.2);
    root.add(smoothRelief(socket,.6,shadow,7.5));
    const lens=new THREE.Shape();
    lens.moveTo(side*4.3,-.4);
    lens.quadraticCurveTo(side*8,.4,side*12.2,1.1);
    lens.quadraticCurveTo(side*10,-1.5,side*7.2,-1.9);
    lens.quadraticCurveTo(side*5.4,-1.8,side*4.3,-.4);
    root.add(smoothRelief(lens,.25,eye,8.5));
    ridge(root,bronze,[[side*2.5,2.3,8],[side*7,4.5,8.7],[side*13,4.2,7.3]],1.05);
    ridge(root,highlight,[[side*4,3.6,8.7],[side*8,5.1,8.2],[side*12.5,4.8,7]],.3);
    ridge(root,bronze,[[side*15,-6,5],[side*12,-10,7],[side*10,-15,6]],.7);
    // 细长的毛流沿发顶后梳，再顺着两颊落下；低对比细脊只提供方向，不切碎轮廓。
    for(let i=0;i<4;i++) {
      ridge(root,bronze,[[side*(2+i*2.3),23-i*.65,3.2],[side*(8+i*1.6),20-i,4.2],
        [side*(13+i*.9),14-i*1.5,4.5],[side*(15+i*.65),7-i*2,3.7]],.22);
    }
    for(let i=0;i<3;i++) ridge(root,face,[[side*(15+i*.8),-7,3.6],
      [side*(14+i*.7),-13,4.2],[side*(9+i),-20,3.9]],.18);
  }
  oval(root,face,[0,-12.8,6],[7.2,5.3,2.6]);
  oval(root,face,[0,-3,7.5],[2.1,6.7,2.4]);
  oval(root,bronze,[0,-9.2,8.7],[3.3,2.1,1.6]);
  for(const side of [-1,1]) oval(root,shadow,[side*1.5,-9.8,10],[.7,.5,.3]);
  ridge(root,shadow,[[-5,-15.3,8],[0,-15.7,8.5],[5,-15.3,8]],.32);
  ridge(root,highlight,[[-4,-19.2,6],[0,-20.7,6.7],[4,-19.2,6]],.35);
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
