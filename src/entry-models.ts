import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { Initialization } from "./scene/initialization.ts";
import { featherSection, silkPoint } from "./entry-motion.ts";

export interface EntryModel {
  root: THREE.Group;
  update(time: number, amount: number, eye: number, silk: number): void;
}

/** 小图标把同材质静态雕刻合批；动态羽片、丝线保留自己的可更新缓冲。 */
function* batchRelief(init: Initialization,root: THREE.Group) {
  const groups=new Map<THREE.Material,THREE.Mesh[]>();
  for(const object of root.children) {
    if(!(object instanceof THREE.Mesh) || Array.isArray(object.material)
      || object.geometry.getAttribute("position").usage===THREE.DynamicDrawUsage) continue;
    const group=groups.get(object.material) ?? [];
    group.push(object);groups.set(object.material,group);
  }
  for(const [material,meshes] of groups) {
    if(meshes.length<2) continue;
    const sources: THREE.BufferGeometry[]=[];
    for(const mesh of meshes) {
      mesh.updateMatrix();
      const geometry=init.track(mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone());
      sources.push(geometry.applyMatrix4(mesh.matrix));
      yield;
    }
    const merged=mergeGeometries(sources);
    sources.forEach(geometry=>init.release(geometry));
    if(!merged) throw new Error("入口雕刻合批失败：静态几何体属性不一致");
    init.track(merged);
    yield;
    for(const mesh of meshes) {root.remove(mesh);init.release(mesh.geometry);}
    root.add(new THREE.Mesh(merged,material));
    yield;
  }
}

/** 有倒角的实体轮廓负责厚度；颜色只用于材质，不用平面贴图伪装模型。 */
function relief(init: Initialization,points: number[][], depth: number, material: THREE.Material, z = 0) {
  const shape = new THREE.Shape();
  points.forEach(([x,y], i) => i ? shape.lineTo(x,y) : shape.moveTo(x,y));
  shape.closePath();
  const geometry = init.track(new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .5, bevelThickness: .45,
  }));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  return mesh;
}

/** 用独立凸面和刻槽塑造眉骨、鼻梁、耳轮，灯光在这些真实曲面上形成明暗。 */
function oval(init: Initialization,root: THREE.Group, material: THREE.Material, position: number[], scale: number[]) {
  const mesh = new THREE.Mesh(init.track(new THREE.SphereGeometry(1, 20, 14)), material);
  mesh.position.set(position[0],position[1],position[2]);
  mesh.scale.set(scale[0],scale[1],scale[2]);
  root.add(mesh);
  return mesh;
}

function ridge(init: Initialization,root: THREE.Group, material: THREE.Material, points: number[][], radius: number) {
  const curve = new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[0],p[1],p[2])));
  root.add(new THREE.Mesh(init.track(new THREE.TubeGeometry(curve, 18, radius, 6, false)),material));
}

/** 连续贝塞尔轮廓用于顺滑毛发和眉弓，保留倒角厚度而不产生三角刺状剪影。 */
function smoothRelief(init: Initialization,shape: THREE.Shape, depth: number, material: THREE.Material, z: number, bevel = .55) {
  const geometry=init.track(new THREE.ExtrudeGeometry(shape,{
    depth,curveSegments:24,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:bevel,bevelThickness:bevel,
  }));
  const mesh=new THREE.Mesh(geometry,material);
  mesh.position.z=z;
  return mesh;
}

/** 羽片和羽轴共用环截面网格；每帧只更新原来的缓冲，不创建几何体或材质。 */
function plume(init: Initialization,root: THREE.Group, material: THREE.Material, shaftMaterial: THREE.Material, side: number) {
  const sections = 32, ring = 8;
  const make = () => {
    const geometry = init.track(new THREE.BufferGeometry());
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

function* buildCrown(init: Initialization): Generator<void, EntryModel> {
  const root=new THREE.Group();
  const gold=init.track(new THREE.MeshStandardMaterial({color:0xc6a159,metalness:.68,roughness:.29}));
  const rim=init.track(new THREE.MeshStandardMaterial({color:0xe8cb88,metalness:.58,roughness:.25}));
  const purple=init.track(new THREE.MeshStandardMaterial({color:0x633665,metalness:.35,roughness:.34}));
  const feather=init.track(new THREE.MeshStandardMaterial({color:0xb89958,metalness:.42,roughness:.43,side:THREE.DoubleSide}));
  const plumes=[plume(init,root,feather,rim,-1),plume(init,root,feather,rim,1)];
  yield;
  root.add(relief(init,[[-19,-10],[-14,-6],[-9,-11],[-6,-2],[0,3],[6,-2],[9,-11],[14,-6],[19,-10],[16,-23],[0,-27],[-16,-23]],3,gold,2));
  yield;
  root.add(relief(init,[[-10,-14],[-6,-6],[0,-1],[6,-6],[10,-14],[7,-22],[0,-24],[-7,-22]],1.7,purple,5.3));
  yield;
  root.add(relief(init,[[0,-5],[4,-12],[0,-18],[-4,-12]],1.4,rim,7.5));
  ridge(init,root,rim,[[-17,-19,6],[-9,-22,7],[0,-23,7.5],[9,-22,7],[17,-19,6]],.68);
  ridge(init,root,gold,[[-15,-24,5],[0,-27,6],[15,-24,5]],.7);
  for(const side of [-1,1]) {
    ridge(init,root,rim,[[side*16,-10,5.5],[side*13,-14,6],[side*12,-18,6]],.55);
    ridge(init,root,rim,[[side*7,-6,6],[side*5,-10,7]],.45);
  }
  yield;
  yield* batchRelief(init,root);
  root.rotation.y=-.1;
  return {root,update(time,amount) {plumes.forEach(update=>update(time,amount));}};
}

/** 丝带用一次分配的动态三角带；横向高斯分布同时保留细芯和柔光，无额外后处理画布。 */
export function redSilk(init: Initialization,root: THREE.Group, side: number, strand: number,
  appearance: { width?: number; reach?: number; glow?: number } = {}) {
  // 参考图入口可单独加强小尺寸红丝；默认参数保持原实体模型的曲线、宽度和光晕。
  const { width: widthScale = 1, reach = 1, glow = .32 } = appearance;
  const segments=36, positions=new Float32Array((segments+1)*2*3), uv=new Float32Array((segments+1)*2*2);
  const geometry=init.track(new THREE.BufferGeometry()), indices: number[]=[];
  for(let i=0;i<=segments;i++) for(let j=0;j<2;j++) {
    const at=i*2+j;
    uv[at*2]=j; uv[at*2+1]=i/segments;
    if(i<segments && j===0) indices.push(at,at+1,at+2,at+1,at+3,at+2);
  }
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv",new THREE.BufferAttribute(uv,2));
  geometry.setIndex(indices);
  const material=init.track(new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, depthTest:false, side:THREE.DoubleSide, toneMapped:false,
    uniforms:{strength:{value:0},glow:{value:glow}},
    vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec2 vUv; uniform float strength; uniform float glow;
      void main(){float d=(vUv.x-.5)*2.;float core=exp(-d*d*75.);float halo=exp(-d*d*4.)*glow;
      float tail=pow(1.-vUv.y,.6);gl_FragColor=vec4(vec3(1.,.075+core*.22,.055+core*.11), (core+halo)*tail*strength);}`,
  }));
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
      const width=p.width*5*widthScale;
      for(let j=0;j<2;j++) {
        const at=(i*2+j)*3;
        positions[at]=side*12.4+(p.x-side*12.4)*reach;
        positions[at+1]=.6+(p.y-.6)*reach+(j?1:-1)*width;positions[at+2]=p.z+3;
      }
    }
    geometry.getAttribute("position").needsUpdate=true;
  };
}

/** 闭合轮廓先三角化并倒圆，再细分长边雕出连续正面，凹发束不使用可能交叠的径向扇面。
 * 仅在创建时细分和焊接顶点；合批后与其他静态部分共用材质绘制。
 */
function* sculptedRelief(init: Initialization,shape: THREE.Shape, material: THREE.Material, center: THREE.Vector2,
  base: number, dome: number, detail: (x: number,y: number)=>number = ()=>0,
  {edgeLength=1.2,curveSegments=12,curvature=.35}={}) {
  const source=init.track(new THREE.ExtrudeGeometry(shape,{depth:2,curveSegments,bevelEnabled:true,
    bevelSegments:4,steps:1,bevelSize:.38,bevelThickness:.5}));
  // 模型没有贴图；清除无用的 UV 差异和旧法线后焊接，曲面明暗才能跨三角面连续。
  source.deleteAttribute("normal");
  source.setAttribute("uv",new THREE.Float32BufferAttribute(new Float32Array(source.getAttribute("position").count*2),2));
  const welded=init.track(mergeVertices(source));init.release(source);
  yield;
  const vertices=Array.from(welded.getAttribute("position").array);
  let triangles=Array.from(welded.index!.array);
  init.release(welded);
  // 相邻三角面共同拆分长边，所有中点只创建一次；避免独立细分留下 T 形接缝和明暗裂纹。
  const key=(a: number,b: number)=>a<b?`${a}:${b}`:`${b}:${a}`;
  const edgeSquared=edgeLength**2;
  for(let iteration=0;iteration<12;iteration++) {
    const edges=new Map<string,number>();
    for(let i=0;i<triangles.length;i+=3) {
      // 长边扫描和三角形重建均在内部检查，避免一次 next() 包住整个雕塑。
      if(i%384===0) yield;
      for(let j=0;j<3;j++) {
        const a=triangles[i+j],b=triangles[i+(j+1)%3],id=key(a,b);
        if(edges.has(id)) continue;
        let distance=0;
        for(let axis=0;axis<3;axis++) distance+=(vertices[a*3+axis]-vertices[b*3+axis])**2;
        if(distance<=edgeSquared) continue;
        edges.set(id,vertices.length/3);
        for(let axis=0;axis<3;axis++) vertices.push((vertices[a*3+axis]+vertices[b*3+axis])/2);
      }
    }
    if(edges.size===0) break;
    const next: number[]=[];
    for(let i=0;i<triangles.length;i+=3) {
      if(i%384===0) yield;
      const a=triangles[i],b=triangles[i+1],c=triangles[i+2];
      const ab=edges.get(key(a,b)),bc=edges.get(key(b,c)),ca=edges.get(key(c,a));
      if(ab!==undefined && bc!==undefined && ca!==undefined) next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
      else if(ab!==undefined && bc!==undefined) next.push(b,bc,ab,a,ab,c,ab,bc,c);
      else if(bc!==undefined && ca!==undefined) next.push(c,ca,bc,b,bc,a,bc,ca,a);
      else if(ca!==undefined && ab!==undefined) next.push(a,ab,ca,c,ca,b,ca,ab,b);
      else if(ab!==undefined) next.push(a,ab,c,ab,b,c);
      else if(bc!==undefined) next.push(b,bc,a,bc,c,a);
      else if(ca!==undefined) next.push(c,ca,b,ca,a,b);
      else next.push(a,b,c);
    }
    triangles=next;
  }
  const geometry=init.track(new THREE.BufferGeometry());
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(new Float32Array(vertices.length/3*2),2));
  geometry.setIndex(triangles);
  const position=geometry.getAttribute("position");
  const extent=new THREE.Box2().setFromPoints(shape.getPoints(16)).getSize(new THREE.Vector2()).multiplyScalar(.5);
  for(let i=0;i<position.count;i++) {
    if(i%128===0) yield;
    const x=position.getX(i),y=position.getY(i),front=(position.getZ(i)+.5)/3;
    // 全局坐标决定弧度；原有倒角与背面一起变形，保持闭合厚度而不产生放射折痕。
    const curve=1-curvature*((x-center.x)/extent.x)**2-curvature*((y-center.y)/extent.y)**2;
    position.setZ(i,base-2.6+front*(2.6+dome*curve+detail(x,y)));
  }
  yield* sculptNormals(geometry);
  return new THREE.Mesh(geometry,material);
}

/** 桃形面框只露出低额头；下颊向两侧撑开，再以宽圆下巴收束，鼻梁直接雕在连续脸面里。 */
function* monkeyFace(init: Initialization,material: THREE.Material) {
  const shape=new THREE.Shape();
  shape.moveTo(0,7.2);
  shape.bezierCurveTo(2.5,7.2,5.3,12,10,10.8);
  shape.bezierCurveTo(15.2,10,17,5.5,15.6,.4);
  shape.bezierCurveTo(15,-3.5,13,-5.1,10.7,-5.7);
  shape.bezierCurveTo(9.1,-6.2,13.5,-9.7,12.5,-14.2);
  shape.bezierCurveTo(11.9,-19.2,6,-21.6,0,-21.6);
  shape.bezierCurveTo(-6,-21.6,-11.9,-19.2,-12.5,-14.2);
  shape.bezierCurveTo(-13.5,-9.7,-9.1,-6.2,-10.7,-5.7);
  shape.bezierCurveTo(-13,-5.1,-15,-3.5,-15.6,.4);
  shape.bezierCurveTo(-17,5.5,-15.2,10,-10,10.8);
  shape.bezierCurveTo(-5.3,12,-2.5,7.2,0,7.2);
  const bump=(x: number,y: number,cx: number,cy: number,wx: number,wy: number)=>
    Math.exp(-(((x-cx)/wx)**2)-((y-cy)/wy)**2);
  return yield* sculptedRelief(init,shape,material,new THREE.Vector2(0,-5),6.2,1.45,(x,y)=>
    1.1*bump(x,y,0,-1.7,2.1,3.8)+2*bump(x,y,0,-5.3,2.8,1.7)
    +.7*bump(x,y,0,-16,7,4.8)
    +.65*(bump(x,y,9,-4,4,3)+bump(x,y,-9,-4,4,3))
    -1.2*(bump(x,y,7,.1,4.3,3.1)+bump(x,y,-7,.1,4.3,3.1)));
}

/** 五束宽发形成参考图的饱满顶冠；少量圆弧鬓毛直接融进剪影，不再雕刻放射沟纹。 */
function* monkeyHair(init: Initialization,material: THREE.Material) {
  const shape=new THREE.Shape();
  shape.moveTo(0,26);
  // 左右各两束与中央主束用圆角谷底相接，发端有钝圆厚度而不是细长尖刺。
  shape.bezierCurveTo(1.5,26,4.2,21,5.1,20.7);
  shape.bezierCurveTo(5.7,20.4,5.2,24.1,6.8,23.6);
  shape.bezierCurveTo(9.2,22.6,11.1,18.8,11.7,17.5);
  shape.bezierCurveTo(12.8,16.4,12.3,21,13.9,19.7);
  shape.bezierCurveTo(18,16,20.2,10.8,20.2,4);
  shape.bezierCurveTo(20.2,-1,19.8,-5.5,18.6,-8);
  shape.bezierCurveTo(21.6,-10.5,21.2,-12,18.2,-11.7);
  shape.bezierCurveTo(21,-14.5,19.3,-16.2,17.1,-15.2);
  shape.bezierCurveTo(18.3,-18.3,15.9,-20.1,14.5,-19.6);
  shape.bezierCurveTo(11.9,-22.4,5,-24.7,0,-25.5);
  // 按相反方向镜像同一组控制点，确保脸面中轴稳定且不引入额外装饰束。
  shape.bezierCurveTo(-5,-24.7,-11.9,-22.4,-14.5,-19.6);
  shape.bezierCurveTo(-15.9,-20.1,-18.3,-18.3,-17.1,-15.2);
  shape.bezierCurveTo(-19.3,-16.2,-21,-14.5,-18.2,-11.7);
  shape.bezierCurveTo(-21.2,-12,-21.6,-10.5,-18.6,-8);
  shape.bezierCurveTo(-19.8,-5.5,-20.2,-1,-20.2,4);
  shape.bezierCurveTo(-20.2,10.8,-18,16,-13.9,19.7);
  shape.bezierCurveTo(-12.3,21,-12.8,16.4,-11.7,17.5);
  shape.bezierCurveTo(-11.1,18.8,-9.2,22.6,-6.8,23.6);
  shape.bezierCurveTo(-5.2,24.1,-5.7,20.4,-5.1,20.7);
  shape.bezierCurveTo(-4.2,21,-1.5,26,0,26);
  // 发冠比脸面更鼓，靠连续曲率表现实体体积；宽毛束无需密集细分或刻线。
  return yield* sculptedRelief(init,shape,material,new THREE.Vector2(0,-1),.8,5.4,()=>0,{edgeLength:4,curveSegments:8,curvature:.7});
}

function* buildMonkey(init: Initialization): Generator<void, EntryModel> {
  const root=new THREE.Group();
  // 暗铜毛发、柔金脸面和深棕眼窝形成三层明度；较高粗糙度让倒角表现柔和而非镜面高光。
  const bronze=init.track(new THREE.MeshStandardMaterial({color:0x8b673e,metalness:.28,roughness:.72}));
  const hairMetal=init.track(new THREE.MeshStandardMaterial({color:0x63482d,metalness:.3,roughness:.76}));
  const face=init.track(new THREE.MeshStandardMaterial({color:0xb39762,metalness:.25,roughness:.72}));
  const highlight=init.track(new THREE.MeshStandardMaterial({color:0xd8bd88,metalness:.18,roughness:.66}));
  const shadow=init.track(new THREE.MeshStandardMaterial({color:0x302015,metalness:.15,roughness:.8}));
  const eye=init.track(new THREE.MeshStandardMaterial({color:0xb99b65,metalness:.18,roughness:.6,emissive:0xff0802,emissiveIntensity:0}));
  face.name="monkey-face";hairMetal.name="monkey-hair";eye.name="monkey-eye";
  root.add(yield* monkeyFace(init,face));
  yield;
  root.add(yield* monkeyHair(init,hairMetal));
  yield;
  for(const side of [-1,1]) {
    // 小耳轮位于鬓角后方，外伸约占整头的 7%；内耳有浅凹面和短耳屏，避免黑色耳洞。
    oval(init,root,bronze,[side*20.2,-.9,.8],[3.3,5.1,2.4]);
    oval(init,root,shadow,[side*21,-.9,2.75],[1.5,3.25,.35]);
    oval(init,root,bronze,[side*20.9,-1,3.1],[1.05,2.65,.42]);
    // 眼窝比眼面略大；外眼角抬高，大眼下缘饱满，眉头压低后仍保留明显的眼白与瞳孔。
    const socket=new THREE.Shape();
    socket.moveTo(side*2.9,1.5);
    socket.bezierCurveTo(side*5,2,side*9.7,5.8,side*12.7,3.6);
    socket.bezierCurveTo(side*15,-1.9,side*10.8,-5.2,side*6.1,-3.8);
    socket.bezierCurveTo(side*3.7,-3,side*3,-.5,side*2.9,1.5);
    yield;
    root.add(smoothRelief(init,socket,.25,bronze,7.45,.45));
    const lens=new THREE.Shape();
    lens.moveTo(side*3.8,1.15);
    lens.bezierCurveTo(side*6.1,1.6,side*9.8,4.4,side*11.9,2.8);
    lens.bezierCurveTo(side*13.2,-1.2,side*10.4,-3.2,side*7,-2.8);
    lens.bezierCurveTo(side*4.9,-2.5,side*3.9,-.9,side*3.8,1.15);
    root.add(yield* sculptedRelief(init,lens,eye,new THREE.Vector2(side*8,-.1),8.3,.65));
    oval(init,root,shadow,[side*7.6,-.15,9.05],[1.85,2.3,.5]);
    oval(init,root,highlight,[side*7.15,.8,9.53],[.35,.42,.14]);
    // 浓眉外高内低，横跨并遮住眼面上缘；圆润的眉头贴近鼻根以表现倔强的凝视。
    const brow=new THREE.Shape();
    brow.moveTo(side*2.6,1.1);
    brow.bezierCurveTo(side*4.9,.9,side*9.3,4,side*12,4.4);
    brow.bezierCurveTo(side*14,4.7,side*13.5,6.1,side*11.8,6.1);
    brow.bezierCurveTo(side*8.9,6,side*5.1,3.4,side*2.7,3.1);
    brow.bezierCurveTo(side*1.8,2.9,side*1.7,1.6,side*2.6,1.1);
    yield;
    root.add(smoothRelief(init,brow,.48,hairMetal,9.25,.36));
  }
  // 短翘鼻由脸面曲率形成；浅鼻孔、短人中和水平唇缝保持克制，嘴角轻压而不微笑。
  for(const side of [-1,1]) oval(init,root,shadow,[side*1.65,-5.9,9.7],[.62,.33,.15]);
  ridge(init,root,bronze,[[0,-7.1,8.1],[0,-8.8,7.9]],.13);
  ridge(init,root,shadow,[[-4.8,-12.2,7.9],[-2.2,-11.85,8.2],[0,-11.8,8.3],[2.2,-11.85,8.2],[4.8,-12.2,7.9]],.16);
  const silk=[-1,1].flatMap(side=>[0,1,2].map(strand=>redSilk(init,root,side,strand)));
  const resting=new THREE.Color(0xb99b65),red=new THREE.Color(0xa90603);
  yield;
  yield* batchRelief(init,root);
  root.rotation.y=-.04;
  return {root,update(time,amount,eyes,threads) {
    // 与文案共用 1.8 秒余弦往返和激活包络；只向右转约 26°，移出、重入及减少动态沿用原调度。
    // 整个实体绕 Y 轴旋转，右耳和右眼自然退后并由深度缓冲遮挡，红丝根点也保持在外眼角。
    root.rotation.y=-.04+.23*(1-Math.cos(time/1000*Math.PI*2/1.8))*amount;
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

/** 与 Three.js 索引法线算法保持相同累加顺序；分开累加和归一化，保留 Float32 舍入结果。 */
function* sculptNormals(geometry: THREE.BufferGeometry): Generator<void> {
  const position=geometry.getAttribute("position"),index=geometry.index!;
  const normal=new THREE.BufferAttribute(new Float32Array(position.count*3),3);
  geometry.setAttribute("normal",normal);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const na=new THREE.Vector3(),nb=new THREE.Vector3(),nc=new THREE.Vector3();
  const cb=new THREE.Vector3(),ab=new THREE.Vector3();
  for(let i=0;i<index.count;i+=3) {
    if(i%384===0) yield;
    const ia=index.getX(i),ib=index.getX(i+1),ic=index.getX(i+2);
    a.fromBufferAttribute(position,ia);b.fromBufferAttribute(position,ib);c.fromBufferAttribute(position,ic);
    cb.subVectors(c,b);ab.subVectors(a,b);cb.cross(ab);
    na.fromBufferAttribute(normal,ia).add(cb);nb.fromBufferAttribute(normal,ib).add(cb);nc.fromBufferAttribute(normal,ic).add(cb);
    normal.setXYZ(ia,na.x,na.y,na.z);normal.setXYZ(ib,nb.x,nb.y,nb.z);normal.setXYZ(ic,nc.x,nc.y,nc.z);
  }
  for(let i=0;i<normal.count;i++) {
    if(i%128===0) yield;
    na.fromBufferAttribute(normal,i).normalize();normal.setXYZ(i,na.x,na.y,na.z);
  }
  normal.needsUpdate=true;
}

/** 离线导出同步消费同一生成器，造型与动画不维护第二份实现。 */
function finishModel(kind: "crown" | "monkey"): EntryModel {
  const init=new Initialization(),steps=kind==="monkey"?buildMonkey(init):buildCrown(init);
  try {
    let result=steps.next();
    while(!result.done) result=steps.next();
    return result.value;
  } catch(error) {init.dispose();throw error;}
}
export function createCrown(): EntryModel {return finishModel("crown");}
export function createMonkey(): EntryModel {return finishModel("monkey");}

/** 每个内部检查点核对取消信号，累计约 8ms 后真实让出任务；资源归调用方的初始化域管理。 */
export async function createEntryModel(kind: "crown" | "monkey", init: Initialization): Promise<EntryModel> {
  const steps=kind==="monkey"?buildMonkey(init):buildCrown(init);
  try {
    await init.checkpoint(true);
    while(true) {
      init.check();
      const result=steps.next();
      if(result.done) return result.value;
      const pause=init.checkpoint();if(pause) await pause;
    }
  } catch(error) {init.dispose();throw error;}
  finally {steps.return(undefined as never);}
}
