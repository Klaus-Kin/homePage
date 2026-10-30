/** 文字保留原始绝对时间点；宝盒的完整提示窗口单独计时。 */
export const CHOICE_DURATION = 720;
export const PROMPT_DURATION = 1800;

/** 平滑开盖、完整绕行、加速收盖和闭合冲击共用纯时间采样，不读取场景或浏览器状态。 */
export function choiceFrame(elapsed: number, reduced = false) {
  const rest = { lid: 0, yaw: 0, pitch: 0, roll: 0, lift: 0, orbit: 0, pull: 0, light: 0, framing: 0 };
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

/** 远端截面采用圆角矩形环线；收紧时仍包住木壁四角，避免椭圆光环切入板材。 */
export function choiceLightPoint(turn: number, pull: number, target: { x: number; y: number; z: number }) {
  const angle = turn * Math.PI * 2, tight = 1 - pull * .04;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  target.x = -3.62 + .065 * Math.sin(angle * 2);
  target.y = .305 - pull * .02 - .40 * tight * Math.sign(cos) * Math.sqrt(Math.abs(cos));
  target.z = .34 * tight * Math.sign(sin) * Math.sqrt(Math.abs(sin));
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
