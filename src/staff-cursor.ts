import { CURSOR_STYLES, cursorKindForTarget } from "./cursor-state.ts";
import type { CursorKind } from "./cursor-state.ts";

/** 用视口内的透明图层显示参考图鼠标；72 像素尺寸固定，热点随形态切换，越界部分由 CSS 自然裁切。 */
export function installStaffCursor() {
  const media = matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
  const root = document.documentElement;
  // 加载与拉幕期间的首帧提交可能阻塞主线程，保留原生光标，避免页面图片随之卡住。
  // 持有实际加载层，而非依赖 app 的状态值：失败出口和正常拉幕都以移除该节点为完成信号。
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
  let lastPoint: { x: number; y: number } | undefined;
  const hide = () => {
    root.classList.remove("staff-cursor-active");
    layer.hidden = true;
  };
  const update = () => {
    if (loader?.isConnected || !media.matches || !lastPoint || document.hidden) { hide(); return; }
    const kind = cursorKindForTarget(document.elementFromPoint(lastPoint.x, lastPoint.y));
    const active = ready.has(kind) ? kind : "staff";
    if (!ready.has(active)) { hide(); return; }
    const current = images[active], style = CURSOR_STYLES[active];
    if (layer.firstChild !== current) layer.replaceChildren(current);
    layer.dataset.cursorKind = active;
    // 在指针事件内直接提交位置，不插值、不使用动画或额外 RAF，保持棒头与实际点击位置一致。
    current.style.transform = `translate3d(${lastPoint.x - style.x}px, ${lastPoint.y - style.y}px, 0)`;
    if (layer.hidden) { layer.hidden = false; root.classList.add("staff-cursor-active"); }
  };
  const leave = () => { lastPoint = undefined; hide(); };
  const change = () => {
    // 仅桌面精细指针需要加载资源；图片成功加载前保持原生光标，避免出现完全不可见的指针。
    if (media.matches) for (const key of Object.keys(images) as CursorKind[]) {
      if (!images[key].getAttribute("src")) images[key].src = CURSOR_STYLES[key].source;
    }
    update();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") { leave(); return; }
    lastPoint = { x: event.clientX, y: event.clientY };
    update();
  };
  // 只观察加载层父级的直接子节点；移除后立即断开，不给主页增加持续的 DOM 监听开销。
  // 鼠标静止时也要在加载结束后完成交接；图片未就绪、已离开窗口或已切到触屏时仍由 update 保留原生回退。
  const loadingObserver = new MutationObserver(() => {
    if (loader?.isConnected) return;
    loadingObserver.disconnect();
    update();
  });
  if (loader?.parentElement) loadingObserver.observe(loader.parentElement, { childList: true });
  const imageEvents = new AbortController();
  for (const key of Object.keys(images) as CursorKind[]) {
    images[key].alt = "";
    images[key].draggable = false;
    images[key].addEventListener("load", () => { ready.add(key); update(); }, { signal: imageEvents.signal });
    images[key].addEventListener("error", () => { ready.delete(key); update(); }, { signal: imageEvents.signal });
  }
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerover", move, { passive: true });
  window.addEventListener("blur", leave);
  window.addEventListener("resize", update, { passive: true });
  root.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", leave);
  media.addEventListener("change", change);
  change();
  return () => {
    // 离页先断开观察器，避免加载层稍后移除时重新显示已经销毁的光标图层。
    loadingObserver.disconnect();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerover", move);
    window.removeEventListener("blur", leave);
    window.removeEventListener("resize", update);
    root.removeEventListener("pointerleave", leave);
    document.removeEventListener("visibilitychange", leave);
    media.removeEventListener("change", change);
    imageEvents.abort();
    hide();
    layer.remove();
  };
}
