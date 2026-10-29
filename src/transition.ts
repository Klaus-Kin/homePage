export type Phase = "loading" | "idle" | "transition" | "redirect";
export interface Timings {
  charge: number;
  fade: number;
  reducedFade: number;
  inscriptionDelay: number;
  write: number;
  reducedWrite: number;
}

/** 纯时间函数只计算开盖和光幕；导航由实际全黑呈现门禁独立决定。 */
export function transitionFrame(
  elapsed: number,
  reduced: boolean,
  timings: Timings,
) {
  const charge = reduced ? 0 : timings.charge;
  const fade = reduced ? timings.reducedFade : timings.fade;
  const progress = Math.max(0, Math.min(1, (elapsed - charge) / fade));
  // 所有视觉通道共用可见时间，场景只接收归一化时间轴，避免独立计时漂移。
  const smooth = (value: number) => value * value * (3 - 2 * value);
  const lid = reduced ? 0 : smooth(Math.max(0, Math.min(1, elapsed / Math.max(1, charge))));
  const spread = smooth(progress);
  return {
    opacity: spread,
    lid,
    spread,
    progress: Math.max(0, Math.min(1, elapsed / Math.max(1, charge + fade))),
    glow: Math.max(0, Math.min(1, reduced ? spread : lid * 0.18 + spread * 0.82)),
    white: elapsed >= charge + fade,
  };
}

/** 实心光圈按最远角计算；羽化边缘独立向外延伸，完成时没有透明边角。 */
export function lightSpread(
  width: number,
  height: number,
  source: { x: number; y: number },
  progress: number,
) {
  const distance = Math.max(...[0, width].flatMap((x) =>
    [0, height].map((y) => Math.hypot(x - source.x, y - source.y))));
  const value = Math.max(0, Math.min(1, progress));
  return {
    ...source,
    radius: distance * value,
    // 初始羽化也从盒口长出，避免刚进入扩散阶段就跳出数百像素宽的白色光团。
    feather: Math.max(24, distance * 0.18) * (1 - value) * Math.min(1, value / 0.08),
  };
}

/** 状态门闩在同步调用内锁定入口，阻止鼠标、键盘和触屏重复触发导航。 */
export class JourneyState {
  phase: Phase = "loading";
  // 地址只能由首次被接受的文字入口写入，宝盒提示不拥有默认目的地。
  private lockedDestination: string | null = null;
  choicePrompting = false;
  get destination() { return this.lockedDestination; }
  ready() {
    if (this.phase === "loading") this.phase = "idle";
  }
  promptChoice() {
    if (this.phase !== "idle" || this.choicePrompting) return false;
    this.choicePrompting = true;
    return true;
  }
  cancelChoicePrompt() { this.choicePrompting = false; }
  begin(destination: string) {
    if (this.phase !== "idle") return false;
    this.lockedDestination = destination;
    this.cancelChoicePrompt();
    this.phase = "transition";
    return true;
  }
  redirect() {
    if (this.phase === "transition") this.phase = "redirect";
  }
}

/** 位移超过阈值视为滑动；指针取消、换指或长按不触发宝盒入口。 */
export function isActivation(
  start: { x: number; y: number; time: number; id: number },
  end: { x: number; y: number; time: number; id: number },
) {
  return (
    start.id === end.id &&
    Math.hypot(end.x - start.x, end.y - start.y) <= 10 &&
    end.time - start.time < 700
  );
}
