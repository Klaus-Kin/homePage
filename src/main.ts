import { pageConfig } from "./config";
import {
  JourneyState,
  isActivation,
  transitionFrame,
  lightSpread,
  WhiteoutGate,
} from "./transition";
import type { MoonScene } from "./scene";

// 启动守卫由 HTML 的无依赖脚本提供，类型声明不会引入新的运行时加载依赖。
declare global {
  interface Window {
    __moonBoot?: { readonly failed: boolean; ready(immediate?: boolean): Promise<boolean> };
  }
}

const app = document.querySelector<HTMLElement>("#app")!;
const button = document.querySelector<HTMLButtonElement>("#box-button")!;
const entrance = document.querySelector<HTMLAnchorElement>("[data-entrance]")!;
const status = document.querySelector<HTMLElement>("#status")!;
const whiteout = document.querySelector<HTMLElement>("#whiteout")!;
const sceneHost = document.querySelector<HTMLElement>("#scene")!;
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = matchMedia("(pointer: coarse)");
const state = new JourneyState();
let scene: MoonScene | undefined;
// 离页时动态导入可能仍在等待，后续回调必须保持终止状态。
let leaving = false;
// 入口超时后才抵达的模块直接沿用静态入口，禁止再次初始化和覆盖已显示的页面。
let fallback = window.__moonBoot?.failed ?? false;
let transitionRaf = 0;
let transitionElapsed = 0;
let transitionLast = 0;
const whiteGate = new WhiteoutGate();
let gesture: { x: number; y: number; time: number; id: number } | null = null;

// 文案只从配置写入文本节点，避免配置内容经由 HTML 注入页面。
document.title = pageConfig.title;
document.querySelector("#page-title > span")!.textContent =
  pageConfig.titleLines[0];
document.querySelector("#page-title > strong")!.textContent =
  pageConfig.titleLines[1];
const description = document.querySelector(".description")!;
description.replaceChildren(
  // 逐行创建文本节点，身份介绍与新文案共用配置；行数变化不会遗漏或解释为 HTML。
  ...pageConfig.description.flatMap((line, index) => index === 0
    ? [document.createTextNode(line)]
    : [document.createElement("br"), document.createTextNode(line)]),
);
entrance.href = pageConfig.blogUrl;
document
  .querySelectorAll<HTMLAnchorElement>("#static-box, .noscript-entry a")
  .forEach((link) => {
    link.href = pageConfig.blogUrl;
  });

function syncViewport() {
  // visualViewport 优先处理移动浏览器地址栏，固定遮罩仍覆盖整个布局视口与安全区。
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--view-height", `${height}px`);
  scene?.resize();
}
function showFallback(error: unknown) {
  if (fallback) return;
  fallback = true;
  console.warn("月光场景不可用，已启用静态博客入口：", error);
  scene?.dispose();
  scene = undefined;
  app.classList.add("fallback");
  button.removeAttribute("style");
  state.ready();
  app.dataset.state = state.phase;
  button.disabled = state.phase !== "idle";
  status.textContent = "已启用静态场景，仍可点击宝盒或文字入口进入博客";
  // 正常的场景降级同样代表首屏就绪，应撤销 HTML 守卫的超时监听。
  // 降级入口优先恢复可用性，不等待正常场景的拉幕动画。
  void window.__moonBoot?.ready(true);
}
window.addEventListener("moon-boot-failed", () =>
  showFallback(new Error("入口守卫已锁定静态场景")),
);

/** 累计实际可见的动画时间；切回后台标签页时不会跳过完整淡黄光幕的展示和停留。 */
function animateTransition(now: number) {
  if (document.hidden) {
    transitionLast = 0;
    transitionRaf = 0;
    return;
  }
  if (transitionLast) transitionElapsed += Math.min(now - transitionLast, 64);
  transitionLast = now;
  const frame = transitionFrame(
    transitionElapsed,
    motionPreference.matches,
    pageConfig.transition,
  );
  scene?.setTransition(frame.progress);
  // 正常场景读取盒内锚点；降级时以截图热点中心定位，不依赖 WebGL。
  let source = scene?.getLightScreenPosition();
  if (!source) {
    // 正常 WebGL 帧不读 DOM 尺寸，避免逐帧写入扩散样式后强制同步布局。
    const rect = button.getBoundingClientRect();
    source = { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.6 };
  }
  const spread = lightSpread(
    window.innerWidth,
    window.innerHeight,
    source,
    frame.spread,
  );
  whiteout.style.setProperty("--light-x", `${spread.x}px`);
  whiteout.style.setProperty("--light-y", `${spread.y}px`);
  whiteout.style.setProperty("--light-radius", `${spread.radius}px`);
  whiteout.style.setProperty("--light-edge", `${spread.radius + spread.feather}px`);
  whiteout.dataset.white = String(frame.white);
  whiteout.dataset.spread = String(frame.spread);
  // 扩散层自身保持不透明，局部渐变决定光照范围；不用整屏透明度代替空间扩散。
  whiteout.style.opacity = frame.spread > 0 ? "1" : "0";
  // 以首次完整呈现不透明光幕的时刻计算停留，避免运行中切换动态偏好提前导航。
  // 过渡中由减少动态切回普通模式时，重新计算下一次连续光幕的停留时间。
  if (whiteGate.present(transitionElapsed, frame.white, pageConfig.transition.hold)) {
    state.redirect();
    app.dataset.state = state.phase;
    status.textContent = "月光之旅即将启程";
    window.location.assign(pageConfig.blogUrl);
    return;
  }
  transitionRaf = requestAnimationFrame(animateTransition);
}
function beginJourney() {
  if (!state.begin()) return;
  app.dataset.state = state.phase;
  button.disabled = true;
  entrance.setAttribute("aria-disabled", "true");
  status.textContent = "宝盒已开启，正在前往博客";
  transitionRaf = requestAnimationFrame(animateTransition);
}

// 鼠标和触屏共享指针门禁；保留原生按钮的键盘语义，不依赖 hover。
button.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isPrimary || state.phase !== "idle") return;
  gesture = {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
    id: event.pointerId,
  };
  button.setPointerCapture(event.pointerId);
});
button.addEventListener("pointerup", (event) => {
  if (!gesture) return;
  const valid = isActivation(gesture, {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
    id: event.pointerId,
  });
  gesture = null;
  if (button.hasPointerCapture(event.pointerId))
    button.releasePointerCapture(event.pointerId);
  if (valid) beginJourney();
});
button.addEventListener("pointermove", (event) => {
  if (
    gesture &&
    Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10
  )
    gesture = null;
});
button.addEventListener("pointercancel", () => {
  gesture = null;
});
button.addEventListener("lostpointercapture", () => {
  gesture = null;
});
button.addEventListener("click", (event) => {
  if (event.detail === 0) beginJourney();
});
button.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "mouse") scene?.setHover(true);
});
button.addEventListener("pointerleave", () => scene?.setHover(false));
button.addEventListener("focus", () => scene?.setHover(true));
button.addEventListener("blur", () => scene?.setHover(false));
entrance.addEventListener("click", (event) => {
  // 主模块只运行了一部分时也保留原生导航，不让已失效的状态机吞掉链接。
  if (window.__moonBoot?.failed) return;
  // 保留链接的标准修饰键行为；普通点击在当前标签页走泛白过渡。
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  beginJourney();
});
window.addEventListener(
  "pointermove",
  (event) => {
    if (
      event.pointerType !== "mouse" ||
      coarsePointer.matches ||
      window.innerWidth < 1024 ||
      state.phase !== "idle"
    )
      return;
    scene?.setPointer(
      (event.clientX / window.innerWidth) * 2 - 1,
      (event.clientY / window.innerHeight) * 2 - 1,
    );
  },
  { passive: true },
);
motionPreference.addEventListener("change", () =>
  scene?.setReducedMotion(motionPreference.matches),
);
window.addEventListener("resize", syncViewport, { passive: true });
window.visualViewport?.addEventListener("resize", syncViewport, {
  passive: true,
});
document.addEventListener("visibilitychange", () => {
  app.classList.toggle("paused", document.hidden);
  if (document.hidden) {
    cancelAnimationFrame(transitionRaf);
    transitionRaf = 0;
    transitionLast = 0;
  } else if (state.phase === "transition" && !transitionRaf)
    transitionRaf = requestAnimationFrame(animateTransition);
});
// bfcache 返回时重新建立待机状态，避免用户看到上一次跳转遗留的淡黄光幕。
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
window.addEventListener("pagehide", () => {
  leaving = true;
  cancelAnimationFrame(transitionRaf);
  scene?.dispose();
});
syncViewport();

async function initialize() {
  if (fallback) return;
  try {
    // 动态导入将 WebGL 初始化错误和模块资源失败纳入同一降级路径。
    const { createScene } = await import("./scene");
    if (fallback || leaving) return;
    scene = await createScene(sceneHost, button, showFallback);
    if (fallback || leaving) {
      scene.dispose();
      scene = undefined;
      return;
    }
    // 首帧已绘制后才开始拉开加载幕布；动画完成前维持 loading 和禁用按钮。
    await window.__moonBoot?.ready();
    if (fallback || leaving) return;
    state.ready();
    app.dataset.state = state.phase;
    button.disabled = false;
    status.textContent = "月光宝盒已就绪，可以点击或使用键盘开启";
  } catch (error) {
    if (!leaving) showFallback(error);
  }
}
void initialize();
