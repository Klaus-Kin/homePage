export type Phase = "loading" | "idle" | "transition" | "redirect";
export interface Timings {
  charge: number;
  fade: number;
  hold: number;
  reducedFade: number;
}

/** 纯时间函数方便验证白幕时序；跳转只允许发生在纯白停留阶段之后。 */
export function transitionFrame(
  elapsed: number,
  reduced: boolean,
  timings: Timings,
) {
  const charge = reduced ? 0 : timings.charge;
  const fade = reduced ? timings.reducedFade : timings.fade;
  const progress = Math.max(0, Math.min(1, (elapsed - charge) / fade));
  return {
    opacity: progress * progress * (3 - 2 * progress),
    glow: Math.min(1, elapsed / Math.max(1, charge + fade)),
    white: elapsed >= charge + fade,
    redirect: elapsed >= charge + fade + timings.hold,
  };
}

/** 状态门闩在同步调用内锁定入口，阻止鼠标、键盘和触屏重复触发导航。 */
export class JourneyState {
  phase: Phase = "loading";
  ready() {
    if (this.phase === "loading") this.phase = "idle";
  }
  begin() {
    if (this.phase !== "idle") return false;
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
