import * as THREE from "three";
import type { Initialization } from "./initialization";

/** 半成品树也注册到同一生命周期；取消时包含实例缓冲、共享材质与阴影贴图。 */
export function ownTree<T extends THREE.Object3D>(init: Initialization, root: T): T {
  init.cleanup(() => root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) init.release(object);
    if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite) {
      if (!(object instanceof THREE.Sprite)) init.release(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) init.release(value);
        init.release(material);
      }
    }
    if (object instanceof THREE.Light && "shadow" in object)
      init.release(object.shadow as THREE.LightShadow);
  }));
  return root;
}
