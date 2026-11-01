import { CURSOR_STYLES, cursorKindForTarget } from "./cursor-state.ts";
import type { CursorKind } from "./cursor-state.ts";
import { colorRevealMask, decodeCursor, targetColorReveal, setColorRevealVisibility } from "./color-reveal.ts";

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
  let colorRaf = 0, disposed = false;
  let previousTarget: Element | null = null;
  let lastPoint: { x: number; y: number } | undefined;
  const hide = () => {
    cancelAnimationFrame(colorRaf); colorRaf = 0;
    root.classList.remove("staff-cursor-active");
    layer.hidden = true;
  };
  const update = () => {
    if (loader?.isConnected || app?.inert || app?.dataset.state === "loading" || !media.matches || !lastPoint || document.hidden) { hide(); return; }
    const hit = document.elementFromPoint(lastPoint.x, lastPoint.y);
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
    layer.dataset.cursorKind = active;
    // 在指针事件内直接提交位置，不插值、不使用动画或额外 RAF，保持棒头与实际点击位置一致。
    const transform = `translate3d(${lastPoint.x - style.x}px, ${lastPoint.y - style.y}px, 0)`;
    current.style.transform = transform;
    if (color) {
      color.style.transform = transform;
      color.style.maskImage = colorRevealMask(progress);
      color.dataset.colorReveal = String(progress);
      // 复色只在进行中请求帧；静止指针也能完成，完成后停止调度。
      if (progress < 1 && target?.matches(":hover, :focus-visible") && !colorRaf)
        colorRaf = requestAnimationFrame(() => { colorRaf = 0; update(); });
    }
    if (layer.hidden) { layer.hidden = false; root.classList.add("staff-cursor-active"); }
  };
  const leave = () => {
    if (previousTarget) targetColorReveal(previousTarget, performance.now(), motion.matches);
    previousTarget = null; lastPoint = undefined; hide();
  };
  const visibility = () => { setColorRevealVisibility(document.hidden, performance.now()); leave(); };
  const change = () => {
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
    update();
  };
  // 只观察加载层移除与页面门禁；两者均完成后立即断开，不给主页增加持续的 DOM 监听开销。
  // 鼠标静止时也要在加载结束后完成交接；图片未就绪、已离开窗口或已切到触屏时仍由 update 保留原生回退。
  const loadingObserver = new MutationObserver(() => {
    if (loader?.isConnected || app?.inert || app?.dataset.state === "loading") return;
    loadingObserver.disconnect();
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
  window.addEventListener("resize", update, { passive: true });
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
    window.removeEventListener("resize", update);
    root.removeEventListener("pointerleave", leave);
    document.removeEventListener("visibilitychange", visibility);
    media.removeEventListener("change", change);
    disposed = true;
    imageEvents.abort();
    hide();
    layer.remove();
  };
}
