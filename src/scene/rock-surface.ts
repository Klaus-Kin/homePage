import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Initialization } from "./initialization";
import { fbm } from "./terrain-math.ts";
import { loadTexturePixels } from "./texture-cache.ts";

/** 参考风化岩块的宽断面与不规则缺口；仅向旧凸包内部雕刻，保留原有落点和避让范围。 */
export async function createWeatheredRockGeometry(envelope: THREE.BufferGeometry, init: Initialization) {
  init.phase = "weathered-rock-geometry";
  const hull = envelope.index ? envelope.toNonIndexed() : envelope.clone();
  const hp = hull.attributes.position;
  const planes: THREE.Plane[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < hp.count; i += 3) {
    a.fromBufferAttribute(hp, i); b.fromBufferAttribute(hp, i + 1); c.fromBufferAttribute(hp, i + 2);
    const plane = new THREE.Plane().setFromCoplanarPoints(a, b, c);
    if (plane.constant > 0) plane.negate();
    planes.push(plane);
  }
  hull.dispose();
  // 几何生成会主动让出主线程，半成品也提前登记，取消初始化时不会遗留缓冲。
  const source = init.track(new THREE.IcosahedronGeometry(1, 7));
  const p = source.attributes.position;
  const direction = new THREE.Vector3();
  // 斜切面打破卵石轮廓；底部不额外削薄，原先埋入草坡的接触关系保持稳定。
  const cuts = [new THREE.Plane(new THREE.Vector3(.32, 1, .17).normalize(), -.76),
    new THREE.Plane(new THREE.Vector3(1, .16, -.31).normalize(), -.83),
    new THREE.Plane(new THREE.Vector3(-.42, .4, 1).normalize(), -.81)];
  const carvingPlanes = [...planes, ...cuts];
  for (let i = 0; i < p.count; i++) {
    if (i % 32 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    direction.fromBufferAttribute(p, i).normalize();
    let radius = 1.1;
    for (const plane of carvingPlanes) {
      const dot = plane.normal.dot(direction);
      if (dot > 1e-6) radius = Math.min(radius, -plane.constant / dot);
    }
    // 浅层起伏只侵蚀表面，不增加轮廓外伸，也不制造密集尖刺。
    const wear = (fbm(direction.x * 5.8 + direction.y * 2.1 + 21,
      direction.z * 5.8 - direction.y * 3.4 + 9) - .25) * .065;
    radius *= 1 - Math.max(0, wear);
    p.setXYZ(i, direction.x * radius, direction.y * radius, direction.z * radius);
  }
  source.deleteAttribute("normal");
  source.deleteAttribute("uv");
  const geometry = mergeVertices(source);
  init.release(source);
  geometry.computeVertexNormals();
  return geometry;
}

/** 无光照的岩面色素与高度：灰色矿物、破碎浅斑、细裂缝、稀疏暗橄榄苔藓共用一张贴图。 */
export async function createRockSurface(init: Initialization) {
  init.phase = "texture-weathered-rock";
  const size = 512, pixels = await loadTexturePixels("weathered-rock", init);
  const texture = init.track(new THREE.DataTexture(pixels, size, size));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const material = init.track(new THREE.MeshStandardMaterial({
    map: texture, bumpMap: texture, bumpScale: .055, roughness: .94, metalness: 0,
  }));
  material.name = "weathered-rock";
  const depth = init.track(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  // 位置哈希提供每块石头独立的纹理偏移与轻微缺损；不消耗布局随机数，响应式切换也不跳变。
  const vary = `varying vec3 vRockPoint; varying vec3 vRockNormal; varying float vRockSeed; varying float vRockScale;\n`;
  const deform = `
    float rockSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
    float rockWear = .055 * rockSeed * pow(max(0.0, dot(normalize(position), normalize(vec3(rockSeed - .5, .7, .4)))), 3.0);
    transformed *= 1.0 - rockWear;
  `;
  const applyShape: THREE.Material["onBeforeCompile"] = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n${deform}`);
  };
  depth.onBeforeCompile = applyShape;
  depth.customProgramCacheKey = () => "weathered-rock-depth-v1";
  material.onBeforeCompile = (shader, renderer) => {
    applyShape(shader, renderer);
    shader.vertexShader = vary + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `
      vRockPoint = transformed;
      vRockNormal = normal;
      vRockSeed = rockSeed;
      vRockScale = length(instanceMatrix[0].xyz);
      #include <project_vertex>`);
    shader.fragmentShader = vary + shader.fragmentShader;
    // 三向混合避免球形 UV 在岩面拉伸与接缝；所有层都交由标准材质接受月光、雾和真实阴影。
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      vec3 rockWeights = pow(abs(normalize(vRockNormal)), vec3(5.0));
      rockWeights /= max(dot(rockWeights, vec3(1.0)), .0001);
      vec3 rockUV = vRockPoint * 1.25 + vec3(vRockSeed * 7.3, vRockSeed * 3.1, vRockSeed * 5.7);
      vec4 rockSample = texture2D(map, rockUV.yz) * rockWeights.x
        + texture2D(map, rockUV.xz) * rockWeights.y + texture2D(map, rockUV.xy) * rockWeights.z;
      diffuseColor.rgb *= rockSample.rgb * mix(.87, 1.08, vRockSeed);
      float rockHeight = rockSample.a;
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
      // 凹凸深度随实例尺寸缩放，小石子不会因为统一世界尺度的凹凸而变成黑色沟壑。
      normal = perturbNormalArb(-vViewPosition, normal,
        vec2(dFdx(rockHeight), dFdy(rockHeight)) * bumpScale * vRockScale * .55, faceDirection);
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
      #include <roughnessmap_fragment>
      roughnessFactor = clamp(.86 + rockHeight * .16, .86, 1.0);
    `);
  };
  material.customProgramCacheKey = () => "weathered-rock-triplanar-v1";
  return { material, depth };
}
