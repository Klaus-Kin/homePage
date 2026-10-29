/** 宝盒提示与文字提示共享一次播放窗口；盒体先归位，文字延迟后完成两次衰减往返。 */
export const CHOICE_DURATION = 720;

/** 仅返回竖直轴角度偏移；不改变盒盖、位置、相机或盒内灯光。 */
export function choiceYaw(elapsed: number, reduced: boolean): number {
  if (reduced || elapsed <= 0 || elapsed >= 260) return 0;
  const progress = elapsed / 260;
  return Math.sin(progress * Math.PI * 4) * (1 - progress) ** 2 * 1.2 * Math.PI / 180;
}

/** 只动画共同外层，图标与文字始终同向同轴；减少动态仍保留相同的可暂停播放窗口。 */
export function choiceKeyframes(reduced: boolean): Keyframe[] {
  return [[0, 0], [80, 0], [160, 6], [320, -6], [480, 3], [640, -3], [720, 0]]
    // 缓动逐段应用，避免整段缓动扭曲 80ms 延迟和各次往返的真实时间。
    .map(([time, x]) => ({ offset: time / CHOICE_DURATION, easing: "ease-in-out", transform: `translateX(${reduced ? 0 : x}px)` }));
}
