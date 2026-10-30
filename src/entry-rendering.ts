import * as THREE from "three";
import type { EntryModel } from "./entry-models.ts";

/** 离线首帧与实时绘制共用全部色彩设置，防止后备图在接管时突然变亮或改变金属色。 */
export function createEntryRenderer(canvas: HTMLCanvasElement) {
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:"low-power"});
  try {
    renderer.setClearColor(0,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.15;
    return renderer;
  } catch(error) {
    // 设置阶段发生异常时，调用方尚未取得实例；由工厂负责释放已创建的上下文。
    renderer.dispose();renderer.forceContextLoss();throw error;
  }
}

/** 图片和实时画布使用相同的透明留白及像素取整规则；DPR 仍限制在 2。 */
export function resizeEntryRenderer(renderer: THREE.WebGLRenderer, size: number, ratio: number) {
  renderer.setPixelRatio(Math.min(ratio,2));
  renderer.setSize(size*1.6,size*1.6,false);
}

/** 首帧导出复用运行时的模型、相机与三盏灯，后续修改造型后只需重新生成图片。 */
export function createEntryScene(model: EntryModel) {
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-51.2,51.2,51.2,-51.2,.1,300);
  camera.position.set(0,0,100);
  scene.add(model.root,new THREE.HemisphereLight(0xd9e3ff,0x332516,2));
  const key=new THREE.DirectionalLight(0xffe4b1,4);
  key.position.set(-25,40,60);
  const fill=new THREE.DirectionalLight(0xa2b6db,1.7);
  fill.position.set(35,5,30);
  scene.add(key,fill);
  return {scene,camera};
}
