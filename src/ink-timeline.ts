export interface InkFrame {
  stage: "waiting" | "drop" | "splash" | "spread" | "fade" | "black";
  elapsed: number;
  fade: number;
  black: boolean;
}

/** 共用前台时钟；起点绑定完整题词的实际帧，减少动态和故障均单向进入淡黑。 */
export class InkTimeline {
  private started: number | null = null;
  private fadeSince: number | null = null;
  private drawnElapsed = 0;
  private black = false;

  present(time: number, complete: boolean, reduced: boolean, failed = false): InkFrame {
    if (this.started === null && !complete) return { stage: "waiting", elapsed: 0, fade: 0, black: false };
    this.started ??= time;
    // 以最后一次已绘制墨迹为冻结点；切回普通模式不能恢复运动或重新落墨。
    if (!this.black && (reduced || failed)) this.fadeSince ??= time;
    if (this.fadeSince === null) this.drawnElapsed = Math.max(this.drawnElapsed, time - this.started);
    const fade = this.fadeSince === null ? 0 : Math.min(1, Math.max(0, (time - this.fadeSince) / 180));
    this.black ||= fade === 1 || (this.fadeSince === null && this.drawnElapsed >= 2400);
    return { elapsed: this.drawnElapsed, fade, black: this.black,
      stage: this.black ? "black" : this.fadeSince !== null ? "fade" : this.drawnElapsed < 120 ? "drop" : this.drawnElapsed < 360 ? "splash" : "spread" };
  }
}

/** 只有渲染器已提交实心 CSS 黑底才开始计时，晚到帧不能预支这 160ms。 */
export class BlackPresentationGate {
  private since: number | null = null;
  present(time: number, renderedBlack: boolean): boolean {
    if (!renderedBlack) this.since = null;
    else this.since ??= time;
    return renderedBlack && this.since !== null && time - this.since >= 160;
  }
}
