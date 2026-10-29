/** 用视口内的透明图层显示原 SVG；方向、72 像素尺寸和 3,3 热点固定，越界部分由 CSS 自然裁切。 */
export function installStaffCursor() {
  const media = matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
  const root = document.documentElement;
  const layer = document.createElement("div");
  const image = new Image(72, 72);
  layer.className = "staff-cursor-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.hidden = true;
  image.alt = "";
  image.draggable = false;
  layer.append(image);
  document.body.append(layer);
  let ready = false;
  let lastPoint: { x: number; y: number } | undefined;
  const hide = () => {
    root.classList.remove("staff-cursor-active");
    layer.hidden = true;
  };
  const update = () => {
    if (!media.matches || !ready || !lastPoint || document.hidden) { hide(); return; }
    // 在指针事件内直接提交位置，不插值、不使用动画或额外 RAF，保持棒头与实际点击位置一致。
    image.style.transform = `translate3d(${lastPoint.x - 3}px, ${lastPoint.y - 3}px, 0)`;
    if (layer.hidden) { layer.hidden = false; root.classList.add("staff-cursor-active"); }
  };
  const leave = () => { lastPoint = undefined; hide(); };
  const load = () => { ready = image.naturalWidth > 0; update(); };
  const error = () => { ready = false; hide(); };
  const change = () => {
    // 仅桌面精细指针需要加载资源；图片成功加载前保持原生光标，避免出现完全不可见的指针。
    if (media.matches && !image.getAttribute("src")) image.src = "/assets/golden-staff-cursor.svg";
    update();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") { leave(); return; }
    lastPoint = { x: event.clientX, y: event.clientY };
    update();
  };
  image.addEventListener("load", load);
  image.addEventListener("error", error);
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerover", move, { passive: true });
  window.addEventListener("blur", leave);
  window.addEventListener("resize", update, { passive: true });
  root.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", leave);
  media.addEventListener("change", change);
  change();
  return () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerover", move);
    window.removeEventListener("blur", leave);
    window.removeEventListener("resize", update);
    root.removeEventListener("pointerleave", leave);
    document.removeEventListener("visibilitychange", leave);
    media.removeEventListener("change", change);
    image.removeEventListener("load", load);
    image.removeEventListener("error", error);
    hide();
    layer.remove();
  };
}
