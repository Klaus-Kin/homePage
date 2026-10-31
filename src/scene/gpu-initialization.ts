import * as THREE from "three";
import type { Initialization } from "./initialization.ts";

/** 先逐张上传纹理，把上传与着色器、几何的首次提交拆开；包含暂时隐藏的开盖和提示资源。 */
export async function initializeTextures(renderer: THREE.WebGLRenderer, scene: THREE.Scene, init: Initialization) {
  const textures=new Set<THREE.Texture>();
  scene.traverse(object=>{
    const material=(object as THREE.Mesh).material;
    for(const entry of Array.isArray(material)?material:material?[material]:[]) {
      for(const value of Object.values(entry)) if(value instanceof THREE.Texture) textures.add(value);
      if(entry instanceof THREE.ShaderMaterial) {
        for(const uniform of Object.values(entry.uniforms)) if(uniform.value instanceof THREE.Texture) textures.add(uniform.value);
      }
    }
  });
  init.phase="gpu-textures";
  await init.checkpoint(true);
  for(const texture of textures) {
    init.check();
    const start=performance.now();
    renderer.initTexture(texture);
    performance.measure("moon-gpu-texture-upload",{start,end:performance.now()});
    await init.checkpoint(true);
  }
}

/** 在真实场景灯光、阴影和材质组合下逐对象首次绘制；异常或取消时也完整恢复可见性。 */
export async function warmScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
  camera: THREE.Camera, init: Initialization) {
  const objects: THREE.Object3D[]=[],layers=new Map<THREE.Object3D,number>();
  scene.traverse(object=>{
    if(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) {
      objects.push(object);layers.set(object,object.layers.mask);
    }
  });
  const active=new Set<THREE.Object3D>();
  scene.traverseVisible(object=>{if(layers.has(object)) active.add(object);});
  try {
    await init.checkpoint(true);
    // 仅关闭对象自身的绘制层，不隐藏父网格，保证其子网格仍能独立参与预热。
    objects.forEach(object=>{object.layers.mask=0;});
    for(const object of active) {
      init.check();
      object.layers.mask=layers.get(object)!;
      // 编译目标限制到当前对象，第三个参数仍提供完整场景的实际灯光、雾和环境。
      const compileStart=performance.now();
      const compilation=renderer.compileAsync(object,camera,scene);
      performance.measure("moon-gpu-object-compile-call",{start:compileStart,end:performance.now()});
      // 记录同步编译调用后先让出，再等待驱动完成；异步等待不计入应用 CPU 批次。
      await init.checkpoint(true);
      await init.waitFor(compilation);
      init.check();
      await init.checkpoint(true);
      renderer.shadowMap.needsUpdate=true;
      const start=performance.now();
      renderer.render(scene,camera);
      performance.measure("moon-gpu-object-submit",{start,end:performance.now()});
      object.layers.mask=0;
      await init.checkpoint(true);
    }
  } finally {
    layers.forEach((value,object)=>{object.layers.mask=value;});
    renderer.shadowMap.needsUpdate=true;
  }
}
