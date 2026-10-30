import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** 细长草叶采用九段弧线与中央折脊，侧面也有真实体积和连续的月光高光。 */
export function createMeadowBlade(segments = 9) {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const width = .026 * Math.pow(1 - t, .72) * (.8 + .35 * Math.sin(t * Math.PI));
    const bend = .44 * t * t;
    for (let side = -1; side <= 1; side++) {
      positions.push(side * width, .82 * t - .25 * t ** 4, bend + (side === 0 ? .007 * Math.sin(t * Math.PI) : 0));
      // 根部自遮蔽与枯灰叶尖以顶点色连续过渡，不画贴片假阴影，也不使用自发光。
      const shade = .26 + .74 * Math.pow(t, .5);
      colors.push(shade * (1 + t * .09), shade, shade * (1 - t * .08));
    }
    if (i < segments) for (let side = 0; side < 2; side++) {
      const a = i * 3 + side, b = a + 3;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** 覆盖弧形叶身、横向风摆及实例倾角；宽度采用允许的最大缩放，三个高度层共用此包络。 */
export function vegetationReach(scale: number, lean = 0, strength = 1) {
  return scale * (.031 + .82 * Math.sin(Math.abs(lean)) + .44 + .82 ** 2 * .24 * strength) + .008;
}

function colorGeometry(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color), colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // 所有部件统一属性后合成一个实例化网格，完整花株只增加一次绘制。
  geometry.deleteAttribute("uv");
  return geometry;
}

function stem(height: number) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(), new THREE.Vector3(-.012, height * .35, .008),
    new THREE.Vector3(.014, height * .72, .018), new THREE.Vector3(.035, height, .025),
  ]);
  return colorGeometry(new THREE.TubeGeometry(curve, 10, .0035, 4, false), 0x3b5130);
}

/** 五枚微下垂的灰白花瓣连在暗黄花心上；三片狭长叶从真正的绿色茎上长出。 */
export function createWildflower() {
  const parts: THREE.BufferGeometry[] = [stem(.63)];
  for (let i = 0; i < 3; i++) {
    const leaf = createMeadowBlade();
    leaf.deleteAttribute("color");
    leaf.scale(.48, .19, .32);
    leaf.rotateZ(.9 + i * .18); leaf.rotateY(i * 2.4);
    leaf.translate(i === 1 ? -.004 : .004, .12 + i * .11, .008);
    parts.push(colorGeometry(leaf, 0x4b6538));
  }
  for (let petal = 0; petal < 5; petal++) {
    const p: number[] = [], index: number[] = [];
    const angle = petal * Math.PI * 2 / 5;
    for (let step = 0; step <= 5; step++) {
      const t = step / 5, width = Math.sin(Math.PI * t) * .018;
      for (const side of [-1, 1]) {
        const r = .012 + t * .064, x = side * width;
        p.push(.035 + Math.cos(angle) * r - Math.sin(angle) * x,
          .63 + .016 * Math.sin(t * Math.PI) - .016 * t * t,
          .025 + Math.sin(angle) * r + Math.cos(angle) * x);
      }
      if (step < 5) { const a = step * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geometry.setIndex(index); geometry.computeVertexNormals();
    parts.push(colorGeometry(geometry, petal % 2 ? 0xb4b8ae : 0xa8aea4));
  }
  const center = new THREE.SphereGeometry(.017, 8, 4);
  center.scale(1, .48, 1); center.translate(.035, .634, .025);
  parts.push(colorGeometry(center, 0x756039));
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  geometry.userData = { petals: 5, leaves: 3 };
  return geometry;
}

/** 零星细穗打破草面轮廓；每一穗粒连在分枝上，夜色下仅呈现低饱和灰褐亮点。 */
export function createSeedHead() {
  const parts: THREE.BufferGeometry[] = [stem(.96)];
  for (let i = 0; i < 10; i++) {
    const angle = i * 2.4, y = .7 + i * .025, radius = .038 * (1 - i / 14);
    const grain = new THREE.SphereGeometry(.009, 4, 3);
    grain.scale(.7, 2, .7); grain.rotateZ(-.35);
    grain.translate(.035 + Math.cos(angle) * radius, y, .025 + Math.sin(angle) * radius);
    parts.push(colorGeometry(grain, i % 3 ? 0x8d9275 : 0x6d795c));
    const branch = new THREE.CylinderGeometry(.001, .0015, radius, 3);
    branch.rotateZ(Math.PI / 2); branch.rotateY(-angle);
    branch.translate(.035 + Math.cos(angle) * radius / 2, y - .007, .025 + Math.sin(angle) * radius / 2);
    parts.push(colorGeometry(branch, 0x5c6e43));
  }
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return geometry;
}
