/** 只有显式诊断页面才输出逐帧验收数据；普通访问不维护调试 DOM 和无界采样数组。 */
export const diagnostics = typeof location !== "undefined" &&
  (new URLSearchParams(location.search).has("diagnostics") ||
    (globalThis as typeof globalThis & { __moonDiagnostics?: boolean }).__moonDiagnostics === true);

/** 每两秒评估真实前台帧；连续慢帧才降档，恢复更保守，避免画质来回震荡。 */
export class AdaptiveQuality {
  level = 0;
  private samples: number[] = [];
  private started: number | undefined;
  private slow = 0;
  private fastSince: number | undefined;
  private changedAt = -Infinity;

  reset() { this.samples.length = 0; this.started = undefined; this.fastSince = undefined; this.slow = 0; }

  sample(now: number, delta: number): { changed: boolean; slowCursor: boolean } {
    this.started ??= now;
    // 后台恢复、断点变更和调试器长暂停由调用方 reset；其余卡帧保留，不能过滤掉真正瓶颈。
    this.samples.push(delta);
    if (now - this.started < 2000) return { changed: false, slowCursor: false };
    const sorted = this.samples.sort((a, b) => a - b);
    const p95 = sorted[Math.floor((sorted.length - 1) * .95)];
    this.samples = []; this.started = now;
    this.slow = p95 > 25 ? this.slow + 1 : 0;
    if (p95 < 18) this.fastSince ??= now;
    else this.fastSince = undefined;
    let changed = false;
    if (this.slow >= 2 && this.level < 3 && now - this.changedAt >= 5000) {
      this.level++; this.slow = 0; changed = true;
    } else if (this.level > 0 && this.fastSince !== undefined && now - this.fastSince >= 15000 &&
        now - this.changedAt >= 5000) {
      this.level--; this.fastSince = now; changed = true;
    }
    if (changed) this.changedAt = now;
    return { changed, slowCursor: p95 > 33 };
  }
}

/** 一个待执行帧吸收 window 和 visualViewport 的重复通知，销毁后不再运行迟到任务。 */
export function coalesceFrame(action: () => void,
  request: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (id: number) => void = cancelAnimationFrame) {
  let frame = 0, disposed = false;
  return {
    request() {
      if (disposed || frame) return;
      frame = request(() => { frame = 0; if (!disposed) action(); });
    },
    dispose() { disposed = true; cancel(frame); frame = 0; },
  };
}
