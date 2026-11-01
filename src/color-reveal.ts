/** 同一命中区域共用绝对可见时间；区域内移动不重播，移出与再次进入立即从底部重新开始。 */
export class ColorReveal {
  private target: object | null = null;
  private started = 0;
  private revealed = 0;
  readonly duration: number;
  constructor(duration: number) { this.duration = duration; }
  select(target: object | null, now: number) {
    if (target === this.target) return;
    this.target = target;
    this.started = now;
    this.revealed = 0;
  }
  progress(now: number, reduced = false) {
    if (!this.target) return 0;
    // 接管采样使用 performance.now，下一帧 RAF 的时间戳可能略早；同次激活不能退回已显示的边界。
    this.revealed = Math.max(this.revealed, reduced ? 1 : Math.max(0, Math.min(1, (now - this.started) / this.duration)));
    return this.revealed;
  }
  synchronize(progress: number, now: number) {
    // 只前移本次激活的起点，保留原有速度和剩余时长；移出后的旧后备采样不得重新激活。
    if (this.target && Number.isFinite(progress)) {
      this.started = Math.min(this.started, now - Math.max(0, Math.min(1, progress)) * this.duration);
    }
    return this.progress(now);
  }
}

const reveals = new WeakMap<Element, ColorReveal>();

/** 两套绘制共享可见时间，后台停留不能消耗复色时长；恢复后沿用已显示的边界。 */
export class ColorRevealClock {
  private hiddenAt: number | undefined;
  private paused = 0;
  setHidden(hidden: boolean, now: number) {
    if (hidden && this.hiddenAt === undefined) this.hiddenAt = now;
    if (!hidden && this.hiddenAt !== undefined) { this.paused += now - this.hiddenAt; this.hiddenAt = undefined; }
  }
  time(now: number) { return (this.hiddenAt ?? now) - this.paused; }
}
const revealClock = new ColorRevealClock();

export function setColorRevealVisibility(hidden: boolean, now: number) { revealClock.setHidden(hidden, now); }

/** 鼠标与图标读取同一时间源；键盘聚焦与悬停合并，不让两条事件路径互相重置。 */
export function targetColorReveal(target: Element, now: number, reduced = false) {
  now = revealClock.time(now);
  let reveal = reveals.get(target);
  if (!reveal) {
    reveal = new ColorReveal(target.matches(".journey-link") ? 700 : 900);
    reveals.set(target, reveal);
  }
  const enabled = !target.matches(":disabled, [aria-disabled='true']");
  reveal.select(enabled && target.matches(":hover, :focus-visible") ? target : null, now);
  return reveal.progress(now, reduced);
}

/** 把当前静态图的可见边界交给鼠标与图标共用的时钟；先核对激活状态，避免迟到接管复活旧进度。 */
export function synchronizeTargetColorReveal(target: Element, progress: number, now: number, reduced = false) {
  targetColorReveal(target, now, reduced);
  return reveals.get(target)!.synchronize(progress, revealClock.time(now));
}

/** 顶部为 0、底部为 1；过渡带在端点完全离开图片，保证首尾没有残留色条。 */
export function colorRevealMask(progress: number) {
  const boundary = 108 - Math.max(0, Math.min(1, progress)) * 116;
  return `linear-gradient(to bottom, transparent ${boundary - 8}%, black ${boundary + 8}%)`;
}

/** decode 拒绝也视为不可交接；load 事件本身不能保证浏览器已准备好可绘制像素。 */
export async function decodeCursor(image: { decode(): Promise<void> }, signal: AbortSignal) {
  try { await image.decode(); return !signal.aborted; }
  catch { return false; }
}
