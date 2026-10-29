export interface InscriptionTimings {
  inscriptionDelay: number;
  write: number;
  reducedWrite: number;
}

export interface InscriptionFrame {
  visible: boolean;
  mode: "waiting" | "writing" | "fade" | "complete";
  progress: number;
  opacity: number;
  complete: boolean;
  announce: boolean;
}

/** 只有前后两帧均在前台时才累计时间；恢复首帧建立新锚点，不补算后台时长。 */
export class VisibleTime {
  private last: number | null = null;
  private elapsed = 0;
  sample(now: number, hidden = false): number {
    if (hidden) this.pause();
    else {
      if (this.last !== null) this.elapsed += Math.max(0, now - this.last);
      this.last = now;
    }
    return this.elapsed;
  }
  pause() { this.last = null; }
}

/** 题词只负责书写、整句淡入和单次播报；实际完成帧交给落墨时间轴消费。 */
export class InscriptionTimeline {
  private timings: InscriptionTimings;
  private last: number | null = null;
  private coverSince: number | null = null;
  private wasReady = false;
  private announced = false;
  private mode: InscriptionFrame["mode"] = "waiting";
  private writing = 0;
  private fading = 0;

  constructor(timings: InscriptionTimings) { this.timings = timings; }

  present(elapsed: number, white: boolean, reduced: boolean): InscriptionFrame {
    let delta = this.last === null ? 0 : Math.max(0, elapsed - this.last);
    this.last = elapsed;
    let announce = false;
    if (!white) {
      this.coverSince = null;
      this.wasReady = false;
    } else {
      this.coverSince ??= elapsed;
      const ready = elapsed - this.coverSince >= this.timings.inscriptionDelay;
      if (ready) {
        // 等待结束的这一帧才真正开始落笔；偏好切换时冻结已有墨迹，再淡入剩余完整字形。
        if (!this.wasReady) delta = 0;
        if (this.mode === "waiting" || (this.mode === "writing" && reduced)) {
          this.mode = reduced ? "fade" : "writing";
          delta = 0;
        }
        if (!this.announced) { announce = true; this.announced = true; }
        if (this.mode === "writing") this.writing = Math.min(this.timings.write, this.writing + delta);
        if (this.mode === "fade") this.fading = Math.min(this.timings.reducedWrite, this.fading + delta);
        if (this.writing >= this.timings.write || this.fading >= this.timings.reducedWrite) this.mode = "complete";
      }
      this.wasReady = ready;
    }
    return {
      visible: white && this.wasReady,
      mode: this.mode,
      progress: this.mode === "complete" ? 1 : this.writing / this.timings.write,
      opacity: this.mode === "complete" ? 1 : this.fading / this.timings.reducedWrite,
      complete: this.mode === "complete",
      announce,
    };
  }
}
