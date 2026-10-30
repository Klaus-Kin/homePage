import * as THREE from "three";
import type { ChoiceFrame, ChoiceLine } from "../choice-prompt";
import { CHOICE_LINES, CHOICE_TRAIL_MS, choiceLightPoint, choiceLineFrame } from "../choice-prompt";
import { glowTexture } from "./textures";

/** 三路金线位于宝盒整体坐标；使用实体深度测试，绕到木盒背面时自然被遮挡。 */
export function createChoiceLight() {
  const group = new THREE.Group();
  group.name = "choice-light";
  const segments = 96, sides = 6, particleCount = 20;
  const texture = glowTexture();
  /** 每路独占动态缓冲与灯光，共用原有外观参数和光晕贴图，不在播放期间创建资源。 */
  function createLine(line: ChoiceLine) {
    const strand = new THREE.Group();
    strand.name = `choice-line-${line.side}`;
    group.add(strand);
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
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0xffdc83,
      transparent: true, depthWrite: false, depthTest: true, toneMapped: false }));
    head.scale.setScalar(.115);
    head.name = "choice-head";
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
    // 点光源只照亮近邻木面，六面阴影由实体木板遮挡；保持材质与全局曝光不变。
    const light = new THREE.PointLight(0xffcc72, 0, .85, 2);
    light.name = `choice-head-light-${line.side}`;
    light.castShadow = true;
    light.shadow.mapSize.setScalar(256);
    light.shadow.camera.near = .008;
    light.shadow.camera.far = light.distance;
    light.shadow.bias = -.00002;
    light.shadow.normalBias = .001;
    // 只在光头活动时更新立方体阴影；关闭提示后释放渲染开销，贴图保留供下一次复用。
    light.shadow.autoUpdate = false;
    strand.add(ribbon, head, particles);
    // 灯保持在场景树中且待机强度为零，启动时统一编译三灯着色器，避免每次出场编译新组合。
    // 阴影贴图首次渲染后复用，待机只停止阴影更新；金线几何仍按各自时序显示。
    group.add(light);
    const point = new THREE.Vector3(), before = new THREE.Vector3(), after = new THREE.Vector3();
    const tangent = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3();
    const axis = new THREE.Vector3(1, 0, 0);

    /** 当前盒盖变换用于全部拖尾点，历史时间只决定在曲线上的前进位置。 */
    function path(elapsed: number, lid: number, target: THREE.Vector3) {
      return choiceLightPoint(elapsed, line, lid, target);
    }
    function update(frame: ChoiceFrame) {
      const state = choiceLineFrame(frame.elapsed, line);
      strand.visible = frame.light > 0 && state.strength > 0;
      light.intensity = strand.visible ? .045 * state.strength : 0;
      light.shadow.needsUpdate = !light.shadow.map || strand.visible;
      if (!strand.visible) return;
      material.opacity = head.material.opacity = particles.material.opacity = state.strength;
      // 拖尾按时间依次进入内腔；光头提前 95ms 到达，合盖接触时最后一个点也已收净。
      for (let i = 0; i <= segments; i++) {
        const t = i / segments, elapsed = Math.max(line.start, frame.elapsed - CHOICE_TRAIL_MS * (1 - t));
        path(elapsed, frame.lid, point);
        path(elapsed - .1, frame.lid, before); path(elapsed + .1, frame.lid, after);
        tangent.subVectors(after, before);
        if (tangent.lengthSq() < 1e-12) tangent.set(0, 1, 0);
        tangent.normalize();
        // 环线切向随盒盖转动，管截面保持垂直于曲线，保留原光带半径及六边形截面。
        normal.crossVectors(tangent, axis).normalize();
        binormal.crossVectors(tangent, normal).normalize();
        for (let j = 0; j < sides; j++) {
          const a = j / sides * Math.PI * 2, radius = .009 * (.3 + .7 * t), k = (i * sides + j) * 3;
          const n = Math.cos(a) * radius, b = Math.sin(a) * radius;
          positions[k] = point.x + normal.x * n + binormal.x * b;
          positions[k + 1] = point.y + normal.y * n + binormal.y * b;
          positions[k + 2] = point.z + normal.z * n + binormal.z * b;
          const fade = t * t;
          colors[k] = fade; colors[k + 1] = fade; colors[k + 2] = fade;
        }
      }
      position.needsUpdate = color.needsUpdate = true;
      path(frame.elapsed, frame.lid, head.position);
      light.position.copy(head.position);
      for (let i = 0; i < particleCount; i++) {
        const age = ((i / particleCount + state.turn * 1.7) % 1), k = i * 3;
        const elapsed = Math.max(line.start, frame.elapsed - age * CHOICE_TRAIL_MS);
        const spread = choiceLineFrame(elapsed, line).spread;
        path(elapsed, frame.lid, point);
        // 保留散粒原大小与扰动；仅在内腔入口/出口收束散布，避免粒子越过侧壁。
        particlePositions[k] = point.x + (-age * .12 + Math.sin(i * 7.3) * age * .10) * spread;
        particlePositions[k + 1] = point.y + age * .10 * Math.cos(i * 2.7) * spread;
        particlePositions[k + 2] = point.z + age * .09 * Math.sin(i * 3.9) * spread;
        particleColors[k] = particleColors[k + 1] = particleColors[k + 2] = (1 - age) ** 2;
      }
      particlePosition.needsUpdate = particleColor.needsUpdate = true;
    }
    return { update };
  }
  const lines = CHOICE_LINES.map(createLine);
  let active = false;
  function update(frame: ChoiceFrame) {
    const wasVisible = active;
    active = frame.light > 0;
    for (const line of lines) line.update(frame);
    // 盖子停在 26° 时光头仍在移动，必须继续刷新真实木板阴影。
    return wasVisible || active;
  }
  // 对象树统一交给现有 ownTree 销毁几何、材质和共享纹理；本模块不注册循环或事件。
  return { group, update, particleCount };
}
