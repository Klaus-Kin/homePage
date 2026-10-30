/** 文字保留原始绝对时间点；宝盒的完整提示窗口单独计时。 */
export const CHOICE_DURATION = 720;
export const PROMPT_DURATION = 1800;

/** 平滑开盖、完整绕行、加速收盖和闭合冲击共用纯时间采样，不读取场景或浏览器状态。 */
export function choiceFrame(elapsed: number, reduced = false) {
  const rest = { elapsed, lid: 0, yaw: 0, pitch: 0, roll: 0, lift: 0, orbit: 0, pull: 0, light: 0, framing: 0 };
  if (reduced || elapsed <= 0 || elapsed >= PROMPT_DURATION) return rest;
  // 仅供确实受入口遮挡的短小屏使用：提前退让，闭合后的尾段平滑回到原取景。
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const framing = elapsed < 1350 ? smooth(Math.min(1, elapsed / 180)) : 1 - smooth((elapsed - 1350) / 450);
  const rad = Math.PI / 180;
  if (elapsed < 300) {
    const t = elapsed / 300;
    return { ...rest, framing, lid: 26 * rad * t * t * (3 - 2 * t), yaw: choiceYaw(elapsed, false) };
  }
  if (elapsed < 1350) {
    const pull = Math.max(0, (elapsed - 1050) / 300);
    return { ...rest, framing, lid: 26 * rad * (1 - pull * pull), orbit: Math.min(1, (elapsed - 300) / 750),
      pull, light: Math.min(1, (elapsed - 300) / 70) };
  }
  const t = (elapsed - 1350) / 450, decay = (1 - t) ** 2;
  // 盖子已完全接触才施加衰减冲击；抬升为模型单位，最大值低于闭盒高度的 4%。
  return { ...rest, framing, yaw: Math.sin(t * Math.PI * 6) * decay * 4 * rad,
    roll: Math.sin(t * Math.PI * 5) * decay * 2 * rad,
    pitch: Math.sin(t * Math.PI * 4) * decay * .6 * rad,
    lift: Math.sin(t * Math.PI * 3) ** 2 * decay * 1.22 * .04 };
}
export type ChoiceFrame = ReturnType<typeof choiceFrame>;

/** 按 Three.js 默认 XYZ 欧拉顺序计算真实底面最低点；补偿只托住底角，不改变额外弹起高度。 */
export function choiceGroundOffset(pitch: number, yaw: number, roll: number): number {
  const rowX = Math.cos(pitch) * Math.sin(roll) + Math.sin(pitch) * Math.cos(roll) * Math.sin(yaw);
  const rowZ = -Math.sin(pitch) * Math.cos(yaw);
  return Math.abs(rowX) * 1.93 + Math.abs(rowZ) * .22;
}

/** 宝盒朝向为 Y 轴半圈，局部正 X 对应画面左侧；出场顺序与实际画面一致。 */
export const CHOICE_LINES = [
  { side: "center", x: 0, start: 300 },
  { side: "left", x: 1.1, start: 360 },
  { side: "right", x: -1.1, start: 420 },
] as const;
export type ChoiceLine = typeof CHOICE_LINES[number];
/** 光头提前入腔，最后一段拖尾在 1350ms 接触帧之前沿同一路径全部收净。 */
export const CHOICE_TRAIL_MS = 95;
const RETURN_END = 1350 - CHOICE_TRAIL_MS;
const clamp = (t: number) => Math.max(0, Math.min(1, t));

/** 独立时间包含上升、两圈和单向返回三段；distance 始终递增，返回段使用凸函数加速。 */
export function choiceLineFrame(elapsed: number, line: ChoiceLine, reduced = false) {
  const rise = clamp((elapsed - line.start) / 90);
  const turn = 2 * clamp((elapsed - line.start - 90) / (1050 - line.start - 90));
  const returnTime = clamp((elapsed - 1050) / (RETURN_END - 1050));
  const pull = .3 * returnTime + .7 * returnTime ** 3;
  return { rise, turn, pull, distance: rise + turn + pull,
    strength: reduced ? 0 : clamp((elapsed - line.start) / 70) * clamp((1350 - elapsed) / CHOICE_TRAIL_MS),
    spread: rise ** 3 * (1 - pull) ** 3 };
}

/**
 * 沿上盖的圆角矩形截面匀速顺行：下方中心→背面→咒文顶面→时光倒流面→下方中心。
 * 圆角半径 .10，木板外留 .16 净空，容纳既有光头、光带和粒子散布，所有连接切线连续。
 */
function lidOrbit(turn: number, target: { x: number; y: number; z: number }) {
  const radius = .10, bottom = -.16, top = .77, side = .38;
  const vertical = top - bottom - radius * 2, horizontal = side * 2 - radius * 2;
  const arc = Math.PI * radius / 2, perimeter = 2 * (vertical + horizontal) + 4 * arc;
  let d = ((turn % 1) + 1) % 1 * perimeter;
  // 首尾各保留半条底边，因此整圈恰好在内侧正下方闭合，且切线始终朝向背面。
  const lengths = [horizontal / 2, arc, vertical, arc, horizontal, arc, vertical, arc, horizontal / 2];
  let section = 0;
  while (section < lengths.length - 1 && d > lengths[section]) d -= lengths[section++];
  const t = d / lengths[section];
  switch (section) {
    case 0: target.y = bottom; target.z = d; break;
    case 1: target.y = bottom + radius - radius * Math.cos(t * Math.PI / 2); target.z = side - radius + radius * Math.sin(t * Math.PI / 2); break;
    case 2: target.y = bottom + radius + d; target.z = side; break;
    case 3: target.y = top - radius + radius * Math.sin(t * Math.PI / 2); target.z = side - radius + radius * Math.cos(t * Math.PI / 2); break;
    case 4: target.y = top; target.z = side - radius - d; break;
    case 5: target.y = top - radius + radius * Math.cos(t * Math.PI / 2); target.z = -side + radius - radius * Math.sin(t * Math.PI / 2); break;
    case 6: target.y = top - radius - d; target.z = -side; break;
    case 7: target.y = bottom + radius - radius * Math.sin(t * Math.PI / 2); target.z = -side + radius - radius * Math.cos(t * Math.PI / 2); break;
    default: target.y = bottom; target.z = -side + radius + d;
  }
}

/**
 * 输出宝盒整体局部坐标。绕行点先按当前铰链变换旋转，上升/返回再与固定下盒内腔平滑连接。
 * 拖尾采样自己的时间、使用当前盒盖角度，防止历史轨迹在合盖时停留在木板内部。
 */
export function choiceLightPoint(elapsed: number, line: ChoiceLine, lid: number,
  target: { x: number; y: number; z: number }) {
  if (elapsed <= line.start || elapsed >= RETURN_END) {
    target.x = line.x; target.y = .36; target.z = 0;
    return target;
  }
  const f = choiceLineFrame(elapsed, line);
  const c = Math.cos(lid), s = Math.sin(lid), x = line.x - 1.93;
  lidOrbit(f.turn, target);
  const lidX = 1.93 + x * c + target.y * s, lidY = .61 - x * s + target.y * c;
  target.x = lidX; target.y = lidY;
  if (f.rise < 1) {
    const t = f.rise, smooth = t * t * (3 - 2 * t);
    target.x = line.x + (lidX - line.x) * smooth;
    target.y = .36 + (lidY - .36) * smooth;
    // 入轨前从内侧上升，末端切线指向背面，与圆角环线的方向一致。
    target.z = -.08 * 3 * (1 - t) * t * t;
  } else if (elapsed >= 1050) {
    const t = f.pull, smooth = t * t * (3 - 2 * t);
    target.x = lidX + (line.x - lidX) * smooth;
    target.y = lidY + (.36 - lidY) * smooth;
    // 接着背面方向向内弯回，不逆放绕行；加速发生在时间采样，端点严格停在原内腔。
    target.z = .11 * 3 * t * (1 - t);
  }
  return target;
}

/** 绕行保留 230ms 拖影；收回的前 140ms 平滑缩回原有 95ms，让尾端加速跟进入腔。 */
export function choiceTrailTime(elapsed: number, age: number, line: ChoiceLine) {
  const t = clamp((elapsed - 1050) / 140), smooth = t * t * (3 - 2 * t);
  const history = 230 + (CHOICE_TRAIL_MS - 230) * smooth;
  return Math.max(line.start, elapsed - history * clamp(age));
}

/**
 * 拖尾仅在光头后方轻摆；以可暂停的提示时间驱动，重复采样不会累计漂移。
 * 摆动主要沿长边展开，垂直木板的偏移限制在 .004 内；头端和入腔端点均严格归零。
 */
export function choiceTrailPoint(elapsed: number, age: number, line: ChoiceLine, lid: number,
  target: { x: number; y: number; z: number }) {
  const time = choiceTrailTime(elapsed, age, line);
  choiceLightPoint(time, line, lid, target);
  const wave = Math.sin(Math.PI * clamp(age)) * choiceLineFrame(time, line).spread;
  const phase = elapsed * .018 + age * 13 + line.start * .025;
  const dx = wave * .045 * Math.sin(phase), dy = wave * .003 * Math.cos(phase * .83);
  // 沿盖子的长边方向摆动，不能用世界 X 摆动而把尾部推入倾斜的木板。
  target.x += dx * Math.cos(lid) + dy * Math.sin(lid);
  target.y += -dx * Math.sin(lid) + dy * Math.cos(lid);
  target.z += wave * .003 * Math.sin(phase * .71);
  return target;
}

/** 仅返回竖直轴角度偏移；不改变盒盖、位置、相机或盒内灯光。 */
export function choiceYaw(elapsed: number, reduced: boolean): number {
  if (reduced || elapsed <= 0 || elapsed >= 260) return 0;
  const progress = elapsed / 260;
  return Math.sin(progress * Math.PI * 4) * (1 - progress) ** 2 * 1.2 * Math.PI / 180;
}

/** 只动画共同外层，图标与文字始终同向同轴；减少动态将位移归零，播放窗口由调用方选择。 */
export function choiceKeyframes(reduced: boolean, duration = CHOICE_DURATION): Keyframe[] {
  const frames: Keyframe[] = [[0, 0], [80, 0], [160, 6], [320, -6], [480, 3], [640, -3], [720, 0]]
    // 缓动逐段应用，避免整段缓动扭曲 80ms 延迟和各次往返的真实时间。
    .map(([time, x]) => ({ offset: time / duration, easing: "ease-in-out", transform: `translateX(${reduced ? 0 : x}px)` }));
  // 仅延长静止尾段，原始 720ms 运动段的时间、幅度及缓动完全不变。
  if (duration > CHOICE_DURATION) frames.push({ offset: 1, transform: "translateX(0px)" });
  return frames;
}
