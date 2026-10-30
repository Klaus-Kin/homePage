import * as THREE from "three";
import type { ChoiceFrame } from "../choice-prompt";
import { choiceLightPoint } from "../choice-prompt";
import { glowTexture } from "./textures";

/** 提示专用金光附着于上盖转轴；使用实体深度测试，绕到木盒背面时自然被遮挡。 */
export function createChoiceLight() {
  const group = new THREE.Group();
  group.name = "choice-light";
  const segments = 96, sides = 6, particleCount = 20;
  const positions = new Float32Array((segments + 1) * sides * 3);
  const colors = new Float32Array(positions.length);
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    indices.push(a, b, a + sides, b, b + sides, a + sides);
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position); geometry.setAttribute("color", color); geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ color: 0xffd274, vertexColors: true,
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false });
  /** 把逐顶点拖尾强度同时用于透明度，避免尾端只变黑、仍遮住后面的木纹与风景。 */
  function fadeTrail(target: THREE.MeshBasicMaterial | THREE.PointsMaterial) {
    target.onBeforeCompile = shader => {
      shader.vertexShader = "varying float vChoiceFade;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <color_vertex>",
        "#include <color_vertex>\nvChoiceFade = color.r;");
      shader.fragmentShader = "varying float vChoiceFade;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.a *= vChoiceFade;");
    };
  }
  fadeTrail(material);
  const ribbon = new THREE.Mesh(geometry, material);
  ribbon.name = "choice-ribbon";
  // 动态位置只更新预分配缓冲；关闭视锥裁剪避免每帧重算包围球或沿用旧球误裁光带。
  ribbon.frustumCulled = false;
  const texture = glowTexture();
  const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0xffdc83,
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false }));
  head.scale.setScalar(.115);
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const particleGeometry = new THREE.BufferGeometry();
  const particlePosition = new THREE.BufferAttribute(particlePositions, 3).setUsage(THREE.DynamicDrawUsage);
  const particleColor = new THREE.BufferAttribute(particleColors, 3).setUsage(THREE.DynamicDrawUsage);
  particleGeometry.setAttribute("position", particlePosition); particleGeometry.setAttribute("color", particleColor);
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({
    map: texture, color: 0xffcf64, size: .035, vertexColors: true, transparent: true,
    depthWrite: false, depthTest: true, toneMapped: false }));
  fadeTrail(particles.material);
  particles.frustumCulled = false;
  particles.name = "choice-gold-particles";
  group.add(ribbon, head, particles);
  group.visible = false;
  const point = new THREE.Vector3();

  /** 绕远端截面完整一周；末段略微收紧并下移，上下/前后半径始终留出木壁厚度。 */
  function path(turn: number, pull: number, target: THREE.Vector3) {
    return choiceLightPoint(turn, pull, target);
  }
  function update(frame: ChoiceFrame) {
    group.visible = frame.light > 0;
    if (!group.visible) return;
    material.opacity = head.material.opacity = particles.material.opacity = frame.light;
    // 拖尾随绕行逐渐铺满一周，前端明亮、尾端渐隐；收紧时保留完整环圈的拉拽感。
    const length = Math.min(frame.orbit, .82 + frame.pull * .18);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments, turn = frame.orbit - length * (1 - t), angle = turn * Math.PI * 2;
      path(turn, frame.pull, point);
      for (let j = 0; j < sides; j++) {
        const a = j / sides * Math.PI * 2, radius = .009 * (.3 + .7 * t), k = (i * sides + j) * 3;
        positions[k] = point.x + Math.cos(a) * radius;
        positions[k + 1] = point.y + Math.sin(a) * Math.cos(angle) * radius;
        positions[k + 2] = point.z + Math.sin(a) * Math.sin(angle) * radius;
        const fade = t * t;
        colors[k] = fade; colors[k + 1] = fade; colors[k + 2] = fade;
      }
    }
    position.needsUpdate = color.needsUpdate = true;
    path(frame.orbit, frame.pull, head.position);
    for (let i = 0; i < particleCount; i++) {
      const age = ((i / particleCount + frame.orbit * 1.7) % 1), k = i * 3;
      path(Math.max(0, frame.orbit - age * Math.min(.25, frame.orbit)), frame.pull, point);
      particlePositions[k] = point.x - age * .12 + Math.sin(i * 7.3) * age * .10;
      particlePositions[k + 1] = point.y + age * .10 * Math.cos(i * 2.7);
      particlePositions[k + 2] = point.z + age * .09 * Math.sin(i * 3.9);
      particleColors[k] = particleColors[k + 1] = particleColors[k + 2] = (1 - age) ** 2;
    }
    particlePosition.needsUpdate = particleColor.needsUpdate = true;
  }
  // 对象树统一交给现有 ownTree 销毁几何、材质和共享纹理；本模块不注册循环或事件。
  return { group, update, particleCount };
}
