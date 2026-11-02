import * as THREE from "three";
import { featherPose } from "./entry-motion.ts";
import { redSilk } from "./entry-models.ts";
import type { EntryModel } from "./entry-models.ts";
import { Initialization } from "./scene/initialization.ts";

/** 月夜素材保持烘焙后的冷金高光，网格只负责羽片变形和转头透视，不再叠加场景灯光染色。 */
function artworkMesh(texture: THREE.Texture, width: number, height: number, init: Initialization,
  color?: THREE.Texture, reveal = { value: 0 }) {
  const geometry = init.track(new THREE.PlaneGeometry(width, height, 48, 48));
  const material = init.track(new THREE.MeshBasicMaterial({
    map: texture, transparent: true, alphaTest: .015, side: THREE.DoubleSide, toneMapped: false,
  }));
  if (color) {
    // gl_FragCoord 与画布高度归一化，使冠座和变形羽毛严格共用水平边界。
    const viewport = { value: new THREE.Vector2(1, 1) };
    material.onBeforeRender = renderer => { renderer.getDrawingBufferSize(viewport.value); };
    material.onBeforeCompile = shader => {
      shader.uniforms.artworkColor = { value: color };
      shader.uniforms.artworkReveal = reveal;
      shader.uniforms.artworkViewport = viewport;
      shader.fragmentShader = `uniform sampler2D artworkColor;\nuniform float artworkReveal;\nuniform vec2 artworkViewport;\n${shader.fragmentShader}`
        .replace("#include <map_fragment>", `
          #include <map_fragment>
          float screenY = gl_FragCoord.y / artworkViewport.y;
          float boundary = artworkReveal * 1.16 - .08;
          float revealed = 1. - smoothstep(boundary - .08, boundary + .08, screenY);
          diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(artworkColor, vMapUv).rgb, revealed);
        `);
    };
    material.customProgramCacheKey = () => "reference-color-reveal-v1";
  }
  return new THREE.Mesh(geometry, material);
}

/** 用原稿上的弯曲羽轴计算柔度；羽根严格固定，羽梢沿原来的异步阵风缓慢摆动。 */
function feather(mesh: THREE.Mesh, side: number, gpu = false) {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  position.setUsage(THREE.DynamicDrawUsage);
  const rest = new Float32Array(position.array), weights = new Float32Array(position.count);
  // 原图裁切后宽高为 808×643；左右羽根分别位于冠座顶部，所有分层共用同一坐标。
  const rootX = side * 3.8, rootY = -3.4;
  const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(rootX, rootY, 0),
    new THREE.Vector3(side * 15, 39, 0), new THREE.Vector3(side * 43, 30, 0),
    new THREE.Vector3(side * 24, -18, 0));
  const axis = curve.getPoints(96);
  for (let i = 0; i < position.count; i++) {
    let nearest = Infinity;
    for (let j = 0; j < axis.length; j++) {
      const distance = (position.getX(i) - axis[j].x) ** 2 + (position.getY(i) - axis[j].y) ** 2;
      if (distance < nearest) { nearest = distance; weights[i] = j / 96; }
    }
  }
  mesh.frustumCulled = false;
  if (gpu) {
    // 静态权重只上传一次；GPU 使用与 featherPose 相同的相位和公式，悬停时不再逐点改写位置缓冲。
    mesh.geometry.setAttribute("featherWeight", new THREE.BufferAttribute(weights, 1));
    const seconds = { value: 0 }, intensity = { value: 0 };
    const material = mesh.material as THREE.Material;
    const compile = material.onBeforeCompile.bind(material), key = material.customProgramCacheKey();
    material.userData.featherMotion = { seconds, intensity, side };
    material.onBeforeCompile = (shader, renderer) => {
      compile(shader, renderer);
      shader.uniforms.featherSeconds = seconds; shader.uniforms.featherAmount = intensity;
      shader.vertexShader = `attribute float featherWeight; uniform float featherSeconds; uniform float featherAmount;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
        #include <begin_vertex>
        float featherSide = ${side.toFixed(1)};
        float featherPhase = ${side < 0 ? ".37" : "2.13"} - featherWeight * 1.65;
        float featherWind = .62 * sin(featherSeconds * 6.28318530718 / ${side < 0 ? "4.3" : "3.7"} + featherPhase)
          + .26 * sin(featherSeconds * 6.28318530718 / 6.71 + featherPhase * 2.)
          + .12 * sin(featherSeconds * 6.28318530718 / 2.93 + featherPhase * .7);
        float featherResponse = featherWeight * featherWeight * featherAmount;
        float featherBend = featherResponse * featherWind * .13962634016 * 5.2;
        vec2 featherRoot = vec2(featherSide * 3.8, -3.4);
        vec2 featherRest = position.xy - featherRoot;
        float featherCos = cos(featherBend), featherSin = sin(featherBend);
        transformed.xy = featherRoot + mat2(featherCos, featherSin, -featherSin, featherCos) * featherRest;
        transformed.z += featherResponse * sin(featherSeconds * 6.28318530718 / 4.7 + featherPhase) * .18 * featherRest.x * .4;
      `);
    };
    material.customProgramCacheKey = () => `${key}:feather-gpu-v1:${side}`;
    return (time: number, amount: number) => { seconds.value = time / 1000; intensity.value = amount; };
  }
  return (time: number, amount: number) => {
    for (let i = 0; i < position.count; i++) {
      const pose = featherPose(weights[i], time, side, amount);
      // 参考图的拱顶权重较低，把弯摆扩大到原来的 5.2 倍，细梢扭转同步加强而羽根仍为零。
      const bend = pose.bend * 5.2;
      const x = rest[i * 3] - rootX, y = rest[i * 3 + 1] - rootY;
      const cos = Math.cos(bend), sin = Math.sin(bend);
      position.setXYZ(i, rootX + x * cos - y * sin, rootY + x * sin + y * cos,
        rest[i * 3 + 2] + pose.twist * x * .4);
    }
    position.needsUpdate = true;
  };
}

/** 曲面深度使眼鼻、耳朵在原有 1.8 秒转头中保留前后关系；单张参考图只提供正面纹理。 */
function monkeySurface(mesh: THREE.Mesh, width: number, height: number) {
  const position = mesh.geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i);
    const dome = Math.max(0, 1 - (x / (width * .5)) ** 2);
    const nose = Math.exp(-((x / 4) ** 2) - ((y + height * .16) / 6) ** 2) * 2;
    position.setZ(i, 1 + dome * 8 + nose);
  }
  mesh.geometry.computeVertexNormals();
}

/** 静态后备导出与运行时共用造型工厂，保留原来的 update 接口及初始化资源域。 */
export function buildEntryArtwork(kind: "crown" | "monkey", textures: THREE.Texture[], init: Initialization,
  colors: THREE.Texture[] = [], gpuFeathers = false): EntryModel {
  const root = new THREE.Group();
  const reveal = { value: 0 };
  const setColorReveal = (progress: number) => { reveal.value = THREE.MathUtils.clamp(progress, 0, 1); };
  if (kind === "crown") {
    const updates: Array<(time: number, amount: number) => void> = [];
    for (let i = 0; i < 3; i++) {
      const mesh = artworkMesh(textures[i], 64, 64 * 407 / 512, init, colors[i], reveal);
      mesh.name = i === 0 ? "artwork-crown-base" : `artwork-feather-${i}`;
      mesh.position.y = 3;
      mesh.position.z = i === 0 ? 2 : 0;
      root.add(mesh);
      if (i > 0) updates.push(feather(mesh, i === 1 ? -1 : 1, gpuFeathers));
    }
    root.rotation.y = -.1;
    return { root, setColorReveal, update(time, amount) { updates.forEach(update => update(time, amount)); } };
  }

  const width = 68 * 408 / 512, mesh = artworkMesh(textures[0], width, 68, init, colors[0], reveal);
  mesh.name = "artwork-monkey";
  monkeySurface(mesh, width, 68);
  root.add(mesh);
  // 只在参考图的两只虹膜内渐变红色，原本的眼睑、眉毛和瞳孔细节仍由原稿提供。
  const eye = { value: 0 };
  mesh.material.userData.eye = eye;
  const compileColor = mesh.material.onBeforeCompile;
  mesh.material.onBeforeCompile = (shader, renderer) => {
    compileColor(shader, renderer);
    shader.uniforms.artworkEye = eye;
    shader.fragmentShader = `uniform float artworkEye;\n${shader.fragmentShader}`.replace("#include <color_fragment>", `
      #include <color_fragment>
      vec2 eyeLeft = (vMapUv - vec2(.387, .457)) / vec2(.030, .014);
      vec2 eyeRight = (vMapUv - vec2(.654, .457)) / vec2(.030, .014);
      float eyeMask = 1. - smoothstep(.35, 1., min(length(eyeLeft), length(eyeRight)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1., .018, .006), eyeMask * artworkEye * .88);
    `);
  };
  mesh.material.customProgramCacheKey = () => "reference-monkey-eyes-color-v2";
  // 复用六条红丝的原曲线和缓冲，仅把根点映射到新参考图的外眼角。
  const updates = [-1, 1].flatMap(side => [0, 1, 2].map(strand => {
    const update = redSilk(init, root, side, strand, { width: 1.9, reach: 1.25, glow: .68 });
    const silk = root.children[root.children.length - 1];
    silk.name = "artwork-silk";
    silk.scale.set(.8, .8, 1);
    silk.position.set(.9, -3.5, -2);
    return update;
  }));
  root.rotation.y = -.04;
  return { root, setColorReveal, update(time, amount, eyes, threads) {
    root.rotation.y = -.04 + .23 * (1 - Math.cos(time / 1000 * Math.PI * 2 / 1.8)) * amount;
    eye.value = eyes;
    updates.forEach(update => update(time, threads));
  } };
}

/** 下载、取消和 GPU 资源仍归已有初始化域；迟到纹理由 wait 释放，故障继续显示参考图后备。 */
export async function createEntryArtwork(kind: "crown" | "monkey", init: Initialization): Promise<EntryModel> {
  const names = kind === "crown" ? ["crown-base", "crown-left", "crown-right"] : ["monkey-artwork"];
  try {
    await init.checkpoint(true);
    const textures = await Promise.all(names.flatMap(name => [name, `${name}-color`]).map(async name => {
      const texture = await init.wait(new THREE.TextureLoader().loadAsync(`/assets/entry-${name}.png`));
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }));
    init.check();
    return buildEntryArtwork(kind, textures.filter((_, i) => i % 2 === 0), init, textures.filter((_, i) => i % 2 === 1), true);
  } catch (error) { init.dispose(); throw error; }
}
