/** 只监听下一次指定导航；新导航与离页均使旧取消回调失效，避免抢占用户后续地址。 */
export class NavigationRecovery {
  private expected: string | undefined;
  private generation = 0;
  private disposed = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private detachAbort: (() => void) | undefined;
  private target: EventTarget | undefined;
  private recover: () => void;

  constructor(target: EventTarget | undefined, recover: () => void) {
    this.target = target;
    this.recover = recover;
    target?.addEventListener("navigate", this.onNavigate);
  }

  watch(destination: string) {
    this.generation++;
    clearTimeout(this.recoveryTimer);
    this.detachAbort?.();
    this.expected = destination;
  }

  private onNavigate = (event: Event) => {
    const navigation = event as Event & { destination: { url: string }; signal: AbortSignal };
    const generation = ++this.generation;
    clearTimeout(this.recoveryTimer);
    this.detachAbort?.();
    if (navigation.destination.url !== this.expected) {
      this.expected = undefined;
      return;
    }
    this.expected = undefined;
    const onAbort = () => {
      // 浏览器取消导航期间会抑制同步和微任务里的重载；排到新任务，等取消步骤结束后再恢复。
      // 这不是等待导航的超时：只有明确 abort 才排队，替换导航会先使旧代次失效。
      this.recoveryTimer = setTimeout(() => {
        if (this.disposed || generation !== this.generation) return;
        this.generation++;
        this.recover();
      }, 0);
    };
    navigation.signal.addEventListener("abort", onAbort, { once: true });
    this.detachAbort = () => navigation.signal.removeEventListener("abort", onAbort);
  };

  dispose() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.recoveryTimer);
    this.detachAbort?.();
    this.target?.removeEventListener("navigate", this.onNavigate);
  }
}
