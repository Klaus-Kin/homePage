import * as THREE from "three";
import type { Initialization } from "./initialization";
import { ownTree } from "./resources";
import { sceneConfig } from "../config";
import { screenPoint } from "../responsive";
import { cloudTexture, glowTexture } from "./textures";
import { seededRandom } from "./terrain-math";
import { meteorFrame } from "./meteor";
import { cloudMotion } from "./cloud-motion";

/** 星空、月球、云海和流星都在同一深度空间中，不依赖 HTML 背景层。 */
export async function createSky(lunarMap: THREE.Texture, init: Initialization) {
  const group = ownTree(init, new THREE.Group()),
    random = seededRandom(942);
  // 月面下载可能在其他生成任务的微任务内完成；先切开任务，避免天空构建接在它们的 CPU 批次后。
  init.phase = "sky-dome";
  await init.checkpoint(true);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(240, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vWorld; void main(){ vWorld=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vWorld;
      void main(){ float h=normalize(vWorld).y;
      vec3 c=mix(vec3(.018,.056,.140),vec3(.0003,.006,.019),smoothstep(-.06,.25,h));
      gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
      }`,
    }),
  );
  dome.renderOrder = -10;
  group.add(dome);
  const glow = init.track(glowTexture()),
    cloudMap = await cloudTexture(init);
  // 缓存命中时 await 不会让浏览器绘制；明确分开星点与月球，保留原随机序列和几何精度。
  init.phase = "sky-stars";
  await init.checkpoint(true);
  const starPositions = new Float32Array(sceneConfig.quality.desktop.stars * 3);
  const colors = new Float32Array(starPositions.length);
  for (let i = 0; i < starPositions.length / 3; i++) {
    const azimuth = random() * Math.PI * 2,
      altitude = random() * 1.35;
    starPositions.set(
      [
        Math.cos(azimuth) * Math.cos(altitude) * 200,
        Math.sin(altitude) * 200,
        Math.sin(azimuth) * Math.cos(altitude) * 200,
      ],
      i * 3,
    );
    const intensity = 0.4 + Math.pow(random(), 3) * 0.6;
    colors.set([intensity * 0.8, intensity * 0.88, intensity], i * 3);
    if (i % 128 === 127) { const pause = init.checkpoint(); if (pause) await pause; }
  }
  const starsGeometry = new THREE.BufferGeometry();
  starsGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(starPositions, 3),
  );
  starsGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  group.add(
    new THREE.Points(
      starsGeometry,
      new THREE.PointsMaterial({
        size: 1.3,
        map: glow,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    ),
  );
  init.phase = "sky-moon";
  await init.checkpoint(true);
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshBasicMaterial({
      map: lunarMap,
      color: new THREE.Color(1.28, 1.24, 1.13),
      fog: false,
      toneMapped: false,
    }),
  );
  // 地图中央为朝向地球的一面；朝向相机展示海盆及第谷辐射纹，避免随机陨石坑的假球感。
  moon.rotation.y = -Math.PI / 2;
  group.add(moon);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: 0xc4d6f9,
      opacity: 0.17,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  group.add(halo);
  const clouds: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  const cloudBases: THREE.Vector3[] = [];
  const cloudScales: THREE.Vector3[] = [];
  init.phase = "sky-clouds";
  await init.checkpoint(true);
  for (let i = 0; i < sceneConfig.quality.desktop.clouds; i++) {
    const cloud = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: cloudMap,
        // 月缘云保持银蓝，谷雾提高蓝灰亮度，层间由真实山体深度遮挡。
        color: i < 6 ? 0xa5b9d4 : 0x9db6d3,
        transparent: true,
        opacity: i < 6 ? 0.62 : 0.26,
        depthWrite: false,
        fog: true,
        side: THREE.DoubleSide,
      }),
    );
    clouds.push(cloud);
    cloudBases.push(new THREE.Vector3());
    cloudScales.push(new THREE.Vector3());
    group.add(cloud);
    const pause = init.checkpoint(); if (pause) await pause;
  }
  // 流星使用有宽度的渐变三角带，局部 +X 为前端，旋转完全由速度得到。
  const meteor = new THREE.Group();
  const frame = meteorFrame(0, { x: -8, y: -5, z: 0 });
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0,
        -frame.headWidth,
        0,
        0,
        frame.headWidth,
        0,
        -5,
        -frame.tailWidth,
        0,
        -5,
        frame.tailWidth,
        0,
      ],
      3,
    ),
  );
  trailGeometry.setAttribute(
    "strength",
    new THREE.Float32BufferAttribute(
      [frame.headAlpha, frame.headAlpha, frame.tailAlpha, frame.tailAlpha],
      1,
    ),
  );
  trailGeometry.setIndex([0, 1, 2, 1, 3, 2]);
  const trailMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { opacity: { value: 1 } },
    vertexShader:
      "attribute float strength; varying float vStrength; void main(){vStrength=strength;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:
      "varying float vStrength; uniform float opacity; void main(){gl_FragColor=vec4(.73,.85,1.,vStrength*vStrength*opacity);}",
  });
  meteor.add(new THREE.Mesh(trailGeometry, trailMaterial));
  const head = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: 0xe5f4ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  head.scale.setScalar(0.48);
  meteor.add(head);
  group.add(meteor);
  const meteorStart = new THREE.Vector3(),
    velocity = new THREE.Vector3(),
    axis = new THREE.Vector3(1, 0, 0);
  return {
    group,
    moon,
    /** 流星平时不可见，预热时临时显现，避免第一次划过天空才创建几何与着色器。 */
    async prepare(compile: () => Promise<void>) {
      const visible = meteor.visible;
      try { meteor.visible = true; await compile(); }
      finally { meteor.visible = visible; }
    },
    resize(
      camera: THREE.PerspectiveCamera,
      preset: (typeof sceneConfig.layout)[keyof typeof sceneConfig.layout],
      mobile: boolean,
    ) {
      const [x, y, radius] = preset.moon;
      const span = 2 * 80 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      moon.position.copy(screenPoint(camera, x, y, 80));
      moon.scale.setScalar(span * radius);
      halo.position.copy(moon.position);
      halo.scale.setScalar(span * radius * 5.5);
      for (let i = 0; i < clouds.length; i++) {
        const cloud = clouds[i];
        // 前六片从月缘右下连续向外伸展，最前层与月面保持明确的深度间隔。
        if (i < 6) {
          cloud.position.copy(
            screenPoint(
              camera,
              x + ((i % 3) - 0.35) * radius * 0.8,
              y + radius * (0.72 + Math.floor(i / 3) * 0.28),
              65 - i,
            ),
          );
          cloud.scale.set(
            span * radius * (2.8 + i * 0.2),
            span * radius * (0.6 + (i % 2) * 0.2),
            1,
          );
          // 最后两片月云延伸到左侧天空，形成参考图地平线前的稀薄卷云层。
          if (i >= 4) {
            cloud.position.copy(screenPoint(camera, x - .29 * (i - 3), y + .11 + (i - 4) * .05, 68));
            cloud.scale.set(span * .95, span * .095, 1);
          }
        } else {
          const j = i - 6;
          // 错开四层谷雾的横向间距、高度与纵深，避免薄片在同一水平线上叠成条带。
          const row = Math.floor(j / 6), column = j % 6;
          cloud.position.set(
            (column - 2.5) * 17 + Math.sin(j * 2.7) * 5,
            -4.2 + row * .9 + Math.sin(j * 1.9) * .9,
            -13 - row * 19 + Math.cos(j * 1.3) * 3,
          );
          cloud.scale.set(27 + (j % 3) * 5, 9 + (j % 2) * 3, 1);
          // 最近一层在支峰前方的低谷铺开，遮住山脚而不吞没峰顶，形成可辨识的云海。
          if (row === 0) {
            cloud.position.y = -.5 + Math.sin(j * 1.9) * .6;
            cloud.position.z = -5 + Math.cos(j * 1.3) * 2;
            cloud.scale.set(22 + (j % 3) * 3, 5.5 + (j % 2), 1);
          }
        }
        cloud.quaternion.copy(camera.quaternion);
        // 轻微倾斜云片，使纹理内部的卷云方向交错，仍朝向当前相机。
        if (i >= 6) cloud.rotateZ(Math.sin(i * 2.3) * .16);
        cloudBases[i].copy(cloud.position);
        cloudScales[i].copy(cloud.scale);
        // 手机保留两片月云和八片谷雾，减少数量时仍保留完整空间层次。
        const moonLayers = mobile ? 2 : 6;
        const valleyLayers =
          sceneConfig.quality[mobile ? "mobile" : "desktop"].clouds -
          moonLayers;
        cloud.visible = i < moonLayers || (i >= 6 && i < 6 + valleyLayers);
      }
      starsGeometry.setDrawRange(
        0,
        sceneConfig.quality[mobile ? "mobile" : "desktop"].stars,
      );
      meteorStart.copy(screenPoint(camera, 0.66, 0.1, 60));
      velocity.set(-8, -5, 0).applyQuaternion(camera.quaternion);
      meteor.quaternion.setFromUnitVectors(axis, velocity.clone().normalize());
    },
    update(time: number, reduced: boolean) {
      for (let i = 0; i < clouds.length; i++) {
        // 只由场景既有可见时间驱动；山体保持静止，雾的漂移与呼吸揭示山间层次。
        const motion = cloudMotion(time, i, reduced);
        clouds[i].position.copy(cloudBases[i]);
        clouds[i].position.x += motion.x;
        clouds[i].position.y += motion.y;
        clouds[i].scale.copy(cloudScales[i]).multiplyScalar(motion.scale);
        clouds[i].material.opacity = motion.opacity * (i < 4 ? .76 : i < 6 ? .22 : 2.05);
      }
      const phase = time % 11;
      meteor.visible = !reduced && phase > 1 && phase < 2.4;
      if (meteor.visible) {
        const sample = meteorFrame(phase - 1, velocity);
        meteor.position
          .copy(meteorStart)
          .add(new THREE.Vector3(sample.head.x, sample.head.y, sample.head.z));
        const opacity = Math.min(1, (phase - 1) * 8, (2.4 - phase) * 5);
        trailMaterial.uniforms.opacity.value = opacity;
        head.material.opacity = opacity;
      }
    },
  };
}
