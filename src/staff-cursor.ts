import { CURSOR_STYLES, cursorKindForTarget } from "./cursor-state.ts";
import type { CursorKind } from "./cursor-state.ts";
import { colorRevealMask, decodeCursor, targetColorReveal, setColorRevealVisibility } from "./color-reveal.ts";
import { diagnostics } from "./performance-policy.ts";

/** 用视口内的透明图层显示参考图鼠标；72 像素尺寸固定，热点随形态切换，越界部分由 CSS 自然裁切。 */
export function installStaffCursor() {
  const media = matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
  const root = document.documentElement;
  const app = document.querySelector<HTMLElement>("#app");
  // 加载与拉幕期间的首帧提交可能阻塞主线程，保留原生光标，避免页面图片随之卡住。
  // 持有实际加载层，并同时等待页面交互门禁解除；失败出口与正常拉幕共用这一交接条件。
  const loader = document.querySelector("#moon-loader");
  const layer = document.createElement("div");
  const image = new Image(72, 72);
  layer.className = "staff-cursor-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.hidden = true;
  image.alt = "";
  image.draggable = false;
  layer.append(image);
  document.body.append(layer);
  // 三种资源提前解码，切换时直接更换已就绪节点，避免换 src 的空白帧。
  const images = { staff: image, point: new Image(72, 72), grab: new Image(72, 72) };
  const ready = new Set<CursorKind>();
  // 原色图与月夜图共用热点与尺寸；只有两层都解码后才接管该手势。
  const colors = { point: new Image(72, 72), grab: new Image(72, 72) };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let colorRaf = 0, handoffRaf = 0, disposed = false;
  let nativeFallback = false, lastHit: Element | null = null, hitDirty = true;
  let nativeImages: HTMLImageElement[] = [];
  // 触屏页面不使用鼠标，避免为它预取三张图片而竞争首屏资源。
  const preloadNative = () => {
    if (!nativeImages.length) nativeImages = Object.values(CURSOR_STYLES).map(style => {
      const image = new Image(); image.src = style.nativeSource; return image;
    });
  };
  let previousTarget: Element | null = null;
  let lastPoint: { x: number; y: number } | undefined;
  const hide = () => {
    cancelAnimationFrame(colorRaf); colorRaf = 0;
    cancelAnimationFrame(handoffRaf); handoffRaf = 0;
    root.classList.remove("staff-cursor-active");
    layer.hidden = true;
  };
  const update = () => {
    if (loader?.isConnected || app?.inert || app?.dataset.state === "loading" || !media.matches || !lastPoint || document.hidden) {
      hide(); root.classList.remove("staff-cursor-native"); return;
    }
    if (nativeFallback) { hide(); root.classList.add("staff-cursor-native"); return; }
    // 事件携带实际命中对象；只有取景改变或加载交接才补一次几何命中，避免每次移动强制刷新布局。
    if (hitDirty) { lastHit = document.elementFromPoint(lastPoint.x, lastPoint.y); hitDirty = false; }
    const hit = lastHit;
    const kind = cursorKindForTarget(hit);
    const active = kind;
    const target = hit?.closest(".journey-link, #box-button, #static-box") ?? null;
    // 即使目标图片尚未就绪也保留交互的起点，静止解码完成后不会重新播放复色。
    const now = performance.now();
    if (previousTarget && previousTarget !== target) targetColorReveal(previousTarget, now, motion.matches);
    previousTarget = target;
    const progress = target ? targetColorReveal(target, now, motion.matches) : 0;
    if (!ready.has(active)) { hide(); return; }
    const current = images[active], style = CURSOR_STYLES[active];
    if (layer.firstChild !== current) layer.replaceChildren(current);
    const color = active === "staff" ? undefined : colors[active];
    if (color && color.parentElement !== layer) layer.append(color);
    if (layer.dataset.cursorKind !== active) layer.dataset.cursorKind = active;
    // 输入事件直接提交最新位置，不再额外等一轮 RAF；复色动画仍使用独立的按需帧。
    const transform = `translate3d(${lastPoint.x - style.x}px, ${lastPoint.y - style.y}px, 0)`;
    current.style.transform = transform;
    if (color) {
      color.style.transform = transform;
      color.style.maskImage = colorRevealMask(progress);
      if (diagnostics) color.dataset.colorReveal = String(progress);
      // 复色只在进行中请求帧；静止指针也能完成，完成后停止调度。
      if (progress < 1 && target?.matches(":hover, :focus-visible") && !colorRaf)
        colorRaf = requestAnimationFrame(() => { colorRaf = 0; update(); });
    }
    if (layer.hidden) layer.hidden = false;
    if (!root.classList.contains("staff-cursor-active") && !handoffRaf) {
      // 先让已解码图片获得一次真实绘制机会，再隐藏同热点的原生光标，避免交接时出现空白指针。
      // hide 会取消这两帧；切到后台、离开页面或图片失效都不能被迟到回调重新接管。
      handoffRaf = requestAnimationFrame(() => {
        handoffRaf = requestAnimationFrame(() => {
          handoffRaf = 0;
          if (!layer.hidden && !disposed) root.classList.add("staff-cursor-active");
        });
      });
    }
  };
  const schedule = () => {
    if (!colorRaf) colorRaf = requestAnimationFrame(() => { colorRaf = 0; update(); });
  };
  const resize = () => { hitDirty = true; schedule(); };
  const slowFrames = async () => {
    if (nativeFallback || disposed || !media.matches) return;
    preloadNative();
    // 三种原生资源都可解码后才回退；失败时由浏览器保留系统手势，不产生不可见的鼠标。
    await Promise.all(nativeImages.map(image => image.decode().catch(() => {})));
    if (disposed) return;
    nativeFallback = true; update();
  };
  const leave = () => {
    if (previousTarget) targetColorReveal(previousTarget, performance.now(), motion.matches);
    previousTarget = null; lastPoint = undefined; lastHit = null; hitDirty = true; hide();
    root.classList.remove("staff-cursor-native");
  };
  const visibility = () => { setColorRevealVisibility(document.hidden, performance.now()); leave(); };
  const change = () => {
    if (media.matches) preloadNative();
    // 仅桌面精细指针需要加载资源；图片成功加载前保持原生光标，避免出现完全不可见的指针。
    if (media.matches) for (const key of Object.keys(images) as CursorKind[]) {
      if (!images[key].getAttribute("src")) images[key].src = CURSOR_STYLES[key].source;
      if (key !== "staff" && !colors[key].getAttribute("src")) colors[key].src = CURSOR_STYLES[key].colorSource;
    }
    update();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") { leave(); return; }
    lastPoint = { x: event.clientX, y: event.clientY };
    lastHit = event.target instanceof Element ? event.target : null;
    // 起点仍取真实进入事件的时间；只合并绘制，不能把既有 700/900ms 复色延后一帧。
    const target = lastHit?.closest(".journey-link, #box-button, #static-box") ?? null;
    if (previousTarget !== target) {
      const now = performance.now();
      if (previousTarget) targetColorReveal(previousTarget, now, motion.matches);
      previousTarget = target;
      if (target) targetColorReveal(target, now, motion.matches);
    }
    hitDirty = false;
    // 只读事件命中对象，update 不读取布局；避免鼠标始终显示上一次输入的位置。
    update();
  };
  // 只观察加载层移除与页面门禁；两者均完成后立即断开，不给主页增加持续的 DOM 监听开销。
  // 鼠标静止时也要在加载结束后完成交接；图片未就绪、已离开窗口或已切到触屏时仍由 update 保留原生回退。
  const loadingObserver = new MutationObserver(() => {
    if (loader?.isConnected || app?.inert || app?.dataset.state === "loading") return;
    loadingObserver.disconnect();
    hitDirty = true;
    update();
  });
  if (loader?.parentElement) loadingObserver.observe(loader.parentElement, { childList: true });
  // ready Promise 的主模块续体晚于移除幕布的 MutationObserver，须等最终 data-state 才能准确命中目标。
  if (app && (loader?.isConnected || app.inert || app.dataset.state === "loading"))
    loadingObserver.observe(app, { attributes: true, attributeFilter: ["data-state", "inert"] });
  const imageEvents = new AbortController();
  for (const key of Object.keys(images) as CursorKind[]) {
    images[key].alt = "";
    images[key].draggable = false;
    images[key].addEventListener("load", async () => {
      const decoded = await decodeCursor(images[key], imageEvents.signal);
      const colorDecoded = key === "staff" || await decodeCursor(colors[key], imageEvents.signal);
      if (disposed || !decoded || !colorDecoded) return;
      ready.add(key); update();
    }, { signal: imageEvents.signal });
    images[key].addEventListener("error", () => { ready.delete(key); update(); }, { signal: imageEvents.signal });
  }
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerover", move, { passive: true });
  window.addEventListener("blur", leave);
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("moon-slow-frames", slowFrames);
  root.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", visibility);
  media.addEventListener("change", change);
  setColorRevealVisibility(document.hidden, performance.now());
  change();
  return () => {
    // 离页先断开观察器，避免加载层稍后移除时重新显示已经销毁的光标图层。
    loadingObserver.disconnect();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerover", move);
    window.removeEventListener("blur", leave);
    window.removeEventListener("resize", resize);
    window.removeEventListener("moon-slow-frames", slowFrames);
    root.removeEventListener("pointerleave", leave);
    document.removeEventListener("visibilitychange", visibility);
    media.removeEventListener("change", change);
    disposed = true;
    imageEvents.abort();
    hide();
    root.classList.remove("staff-cursor-native");
    layer.remove();
  };
}
