import * as THREE from "three";
import { sceneConfig } from "../config";
import { screenPoint } from "../responsive";
import { cloudTexture, glowTexture } from "./textures";
import { seededRandom } from "./terrain-math";
import { meteorFrame } from "./meteor";

/** 星空、月球、云海和流星都在同一深度空间中，不依赖 HTML 背景层。 */
export function createSky(lunarMap: THREE.Texture) {
  const group = new THREE.Group(),
    random = seededRandom(942);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(240, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vWorld; void main(){ vWorld=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vWorld;
      void main(){ float h=normalize(vWorld).y;
      vec3 c=mix(vec3(.012,.028,.065),vec3(.0008,.002,.009),smoothstep(-.06,.4,h));
      gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
      }`,
    }),
  );
  dome.renderOrder = -10;
  group.add(dome);
  const glow = glowTexture(),
    cloudMap = cloudTexture();
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
  for (let i = 0; i < sceneConfig.quality.desktop.clouds; i++) {
    const cloud = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: cloudMap,
        color: i < 6 ? 0xb5bdce : 0x7893b5,
        transparent: true,
        opacity: i < 6 ? 0.62 : 0.26,
        depthWrite: false,
        fog: true,
        side: THREE.DoubleSide,
      }),
    );
    clouds.push(cloud);
    cloudBases.push(new THREE.Vector3());
    group.add(cloud);
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
        } else {
          const j = i - 6;
          cloud.position.set(
            ((j % 6) - 2.5) * 19,
            -2.5 + Math.floor(j / 6) * 0.7,
            -12 - Math.floor(j / 6) * 15,
          );
          cloud.scale.set(33 + (j % 3) * 8, 4 + (j % 2) * 2, 1);
        }
        cloud.quaternion.copy(camera.quaternion);
        cloudBases[i].copy(cloud.position);
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
        clouds[i].position.copy(cloudBases[i]);
        if (!reduced)
          clouds[i].position.x +=
            Math.sin(time * 0.027 + i * 0.6) * (i < 6 ? 0.65 : 1.2);
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
