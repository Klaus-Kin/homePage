import { pageConfig } from "./config";
import { installStaffCursor } from "./staff-cursor";
import { Inscription } from "./inscription";
import { INSCRIPTION_TEXT } from "./inscription-strokes";
import { InscriptionTimeline, VisibleTime } from "./inscription-timeline";
import { InkTimeline, BlackPresentationGate } from "./ink-timeline";
import { InkTransition } from "./ink-transition";
import { CHOICE_DURATION, PROMPT_DURATION, choiceKeyframes } from "./choice-prompt";
import {
  JourneyState,
  isActivation,
  transitionFrame,
  lightSpread,
} from "./transition";
import type { MoonScene } from "./scene";

// 启动守卫由 HTML 的无依赖脚本提供，类型声明不会引入新的运行时加载依赖。
declare global {
  interface Window {
    __moonBoot?: { readonly failed: boolean; ready(): Promise<boolean>; progress(stage: string): void };
  }
}

const app = document.querySelector<HTMLElement>("#app")!;
const button = document.querySelector<HTMLButtonElement>("#box-button")!;
const entrances = [...document.querySelectorAll<HTMLAnchorElement>("[data-entrance]")];
const choices = document.querySelector<HTMLElement>("#journey-choices")!;
const choiceMotion = choices.querySelector<HTMLElement>(".choice-motion")!;
const status = document.querySelector<HTMLElement>("#status")!;
const whiteout = document.querySelector<HTMLElement>("#whiteout")!;
const sceneHost = document.querySelector<HTMLElement>("#scene")!;
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = matchMedia("(pointer: coarse)");
// 光标独立于 WebGL 就绪状态工作，场景正常降级时仍能处理窗口边缘。
const disposeStaffCursor = installStaffCursor();
const state = new JourneyState();
let scene: MoonScene | undefined;
// 离页时动态导入可能仍在等待，后续回调必须保持终止状态。
let leaving = false;
// 图标有独立失败边界；不影响主场景、静态入口或旅程导航的既有启动门禁。
let disposeEntryIcons: ReturnType<typeof import("./entry-icons").installEntryIcons> | undefined;
// 入口超时后才抵达的模块直接沿用静态入口，禁止再次初始化和覆盖已显示的页面。
let fallback = window.__moonBoot?.failed ?? false;
let transitionRaf = 0;
// 题词与落墨复用转场 RAF；后台暂停，导航由实际提交的全黑画面门禁控制。
// 与场景自身的 50ms 单帧预算一致：卡顿延长演出，不以跳过开盖、落笔和墨滴追赶墙钟。
const transitionClock = new VisibleTime(50);
const inscriptionTimeline = new InscriptionTimeline(pageConfig.transition);
const inscription = new Inscription(document.querySelector<HTMLElement>("#inscription")!, pageConfig.transition.write);
const inkTimeline = new InkTimeline();
const blackGate = new BlackPresentationGate();
const inkTransition = new InkTransition(document.querySelector<SVGSVGElement>('#inscription [data-character="界"]')!);
let inscriptionLocked = false;
let renderedBlack = false;
// 守卫失败后，完整装载的主模块仍可提供题词和落墨；只在同步初始化尚未完成时保留原生链接。
let journeyAvailable = false;
let gesture: { x: number; y: number; time: number; id: number } | null = null;
// Web Animations 的完成事件维护提示门禁；盒体仍由场景既有循环绘制，不新增 RAF 或定时器。
let choiceAnimation: Animation | undefined;
// 正常场景延长静止尾段；减少动态或 WebGL 降级仍沿用原来的 720ms 提示。
let choiceDuration = CHOICE_DURATION;
let choiceStatic = false;

// 文案只从配置写入文本节点，避免配置内容经由 HTML 注入页面。
document.title = pageConfig.title;
// 标题的小篆和可访问文字由构建时共用配置生成，保留静态 SVG，避免启动后换字。
// 正文、入口和加载语也在 HTML 转换阶段复用同一小篆字形，启动时保留已有节点。
entrances.forEach(link => {
  link.href = link.dataset.entrance === "world" ? pageConfig.worldUrl : pageConfig.blogUrl;
});
document
  .querySelectorAll<HTMLAnchorElement>(".noscript-entry a")
  .forEach((link) => {
    link.href = pageConfig.blogUrl;
  });

function syncViewport() {
  // visualViewport 优先处理移动浏览器地址栏，固定遮罩仍覆盖整个布局视口与安全区。
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--view-height", `${height}px`);
  scene?.resize();
  inkTransition.resize();
}
function showFallback(error: unknown) {
  if (fallback) return;
  fallback = true;
  disposeEntryIcons?.cancelPending();
  console.warn("月光场景不可用，已启用静态博客入口：", error);
  scene?.dispose();
  scene = undefined;
  app.classList.add("fallback");
  // 播放中失去 WebGL 也退回原文字窗口，保留绝对播放时间，不等待已经销毁的盒体动作。
  if (choiceAnimation) {
    choiceDuration = CHOICE_DURATION;
    const effect = choiceAnimation.effect as KeyframeEffect;
    effect.setKeyframes(choiceKeyframes(choiceStatic, choiceDuration));
    effect.updateTiming({ duration: choiceDuration });
  }
  button.removeAttribute("style");
  // 正常的场景降级同样代表首屏就绪，应撤销 HTML 守卫的超时监听。
  // 先准备幕后的静态画面，再经过同一段开幕；首开与超时降级都不允许直接拆掉幕布。
  void finishStartup();
}
window.addEventListener("moon-boot-failed", () =>
  showFallback(new Error("入口守卫已锁定静态场景")),
);

/** 累计实际可见的动画时间；切回后台标签页时不会跳过完整淡黄光幕的展示和停留。 */
function animateTransition(now: number) {
  if (document.hidden) {
    transitionClock.pause();
    transitionRaf = 0;
    return;
  }
  const transitionElapsed = transitionClock.sample(now);
  // 当前 RAF 只能确认上一帧提交的黑底已经有机会绘制；首次设置 CSS 的当帧不预支呈现时间。
  const canNavigate = blackGate.present(transitionElapsed, renderedBlack);
  const calculated = transitionFrame(
    transitionElapsed,
    motionPreference.matches,
    pageConfig.transition,
  );
  // 落墨后锁住已呈现的淡黄底幕和完整题词，偏好切换不允许回退到开盖或光圈阶段。
  const frame = inscriptionLocked ? { ...calculated, white: true, spread: 1, progress: 1 } : calculated;
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
  // 题词完整呈现的同一帧立即落墨；全黑由渲染器确认后另计前台停留，不使用理论终点跳转。
  const inscriptionFrame = inscriptionTimeline.present(transitionElapsed, frame.white, motionPreference.matches);
  inscription.render(inscriptionFrame);
  if (inscriptionFrame.announce) status.textContent = INSCRIPTION_TEXT;
  inscriptionLocked ||= inscriptionFrame.visible && inscriptionFrame.complete;
  let inkFrame = inkTimeline.present(transitionElapsed, inscriptionLocked, motionPreference.matches, inkTransition.unavailable);
  let black = inkTransition.render(inkFrame);
  if (inkTransition.unavailable && inkFrame.stage !== "fade" && !inkFrame.black) {
    // 初始化或当帧绘制失败立即启动新的 180ms 淡黑，避免等下一帧才建立故障锚点。
    inkFrame = inkTimeline.present(transitionElapsed, inscriptionLocked, motionPreference.matches, true);
    black = inkTransition.render(inkFrame);
  }
  renderedBlack = black;
  if (black && canNavigate) {
    state.redirect();
    app.dataset.state = state.phase;
    window.location.assign(state.destination!);
    return;
  }
  transitionRaf = requestAnimationFrame(animateTransition);
}
/** 结束或取消均释放动画效果并恢复精确原位，避免后续转场继承抖动偏移。 */
function cancelChoicePrompt() {
  if (choiceAnimation) {
    choiceAnimation.onfinish = null;
    choiceAnimation.cancel();
    choiceAnimation = undefined;
  }
  state.cancelChoicePrompt();
  delete choices.dataset.prompt;
  scene?.cancelChoicePrompt();
  // 清空已结束的播报，让下一次独立提示再次产生可被辅助技术感知的文本变化。
  if (state.phase === "idle" && status.textContent === "请选择一个文字入口，开启旅程") status.textContent = "";
}

/** 宝盒不选择地址；键盘激活后进入第一项，鼠标与触屏保留当前焦点。 */
function promptChoice(keyboard = false) {
  if (!state.promptChoice()) return;
  choices.dataset.prompt = "true";
  scene?.promptChoice();
  choiceStatic = motionPreference.matches;
  choiceDuration = scene && !choiceStatic ? PROMPT_DURATION : CHOICE_DURATION;
  choiceAnimation = choiceMotion.animate(choiceKeyframes(choiceStatic, choiceDuration), {
    duration: choiceDuration, easing: "linear", fill: "both",
  });
  choiceAnimation.onfinish = cancelChoicePrompt;
  if (document.hidden) choiceAnimation.pause();
  status.textContent = "请选择一个文字入口，开启旅程";
  if (keyboard) entrances[0].focus({ preventScroll: true });
}

function beginJourney(destination: string) {
  if (!state.begin(destination)) return;
  // 开始旅程立即终止未接管的装饰构建，让首次开盖和指针继续使用既有动画循环。
  disposeEntryIcons?.cancelPending();
  cancelChoicePrompt();
  app.dataset.state = state.phase;
  button.disabled = true;
  entrances.forEach(link => {
    link.setAttribute("aria-disabled", "true");
    link.tabIndex = -1;
  });
  status.textContent = "宝盒已开启，正在前往所选旅程";
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
  if (valid) promptChoice();
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
  if (event.detail === 0) promptChoice(true);
});
button.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "mouse") scene?.setHover(true);
});
button.addEventListener("pointerleave", () => scene?.setHover(false));
button.addEventListener("focus", () => scene?.setHover(true));
button.addEventListener("blur", () => scene?.setHover(false));
function onEntryClick(event: MouseEvent) {
  // 主模块只运行了一部分时也保留原生导航，不让已失效的状态机吞掉链接。
  if (!journeyAvailable) return;
  // 接受首项后包括修饰键激活也不再执行，防止过渡期间另开目的地或改写地址。
  if (state.phase !== "idle") { event.preventDefault(); return; }
  // 保留链接的标准修饰键行为；普通点击在当前标签页走泛白过渡。
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const link = event.currentTarget as HTMLAnchorElement;
  beginJourney(link.dataset.entrance === "world" ? pageConfig.worldUrl : pageConfig.blogUrl);
}
// WebGL 降级后的文字入口走同一题词流程；静态宝盒热点仅定位到选项区域。
document.querySelectorAll<HTMLAnchorElement>("[data-entrance], .noscript-entry a")
  .forEach(link => link.addEventListener("click", onEntryClick));
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
/** 偏好切换只替换关键帧，保留已播放时间，绝不重播提示或重置旅程。 */
function onMotionChange() {
  if (choiceAnimation) {
    choiceStatic ||= motionPreference.matches;
    (choiceAnimation.effect as KeyframeEffect).setKeyframes(choiceKeyframes(choiceStatic, choiceDuration));
  }
  scene?.setReducedMotion(motionPreference.matches);
}
motionPreference.addEventListener("change", onMotionChange);
window.addEventListener("resize", syncViewport, { passive: true });
window.visualViewport?.addEventListener("resize", syncViewport, {
  passive: true,
});
function onVisibilityChange() {
  app.classList.toggle("paused", document.hidden);
  if (document.hidden) choiceAnimation?.pause();
  else choiceAnimation?.play();
  if (document.hidden) {
    cancelAnimationFrame(transitionRaf);
    transitionRaf = 0;
    transitionClock.pause();
  } else if (state.phase === "transition" && !transitionRaf)
    transitionRaf = requestAnimationFrame(animateTransition);
}
document.addEventListener("visibilitychange", onVisibilityChange);
// bfcache 的最早遮挡与刷新由无依赖 HTML 守卫负责，主模块销毁后也不会露出旧题词。
window.addEventListener("pagehide", () => {
  leaving = true;
  cancelChoicePrompt();
  motionPreference.removeEventListener("change", onMotionChange);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  disposeStaffCursor();
  disposeEntryIcons?.();
  inkTransition.dispose(renderedBlack);
  cancelAnimationFrame(transitionRaf);
  scene?.dispose();
});
syncViewport();
journeyAvailable = true;

/** 正常场景与静态场景共用开幕和输入门禁，重复就绪只等待同一个 Promise。 */
async function finishStartup() {
  await window.__moonBoot?.ready();
  if (leaving) return;
  state.ready();
  app.dataset.state = state.phase;
  button.disabled = state.phase !== "idle";
  status.textContent = fallback ? "已启用静态场景，请选择文字入口开启旅程"
    : "月光宝盒已就绪，请选择文字入口开启旅程";
}

async function initialize() {
  if (fallback) { await finishStartup(); return; }
  try {
    // 动态导入将 WebGL 初始化错误和模块资源失败纳入同一降级路径。
    window.__moonBoot?.progress("scene-module");
    const { createScene } = await import("./scene");
    if (fallback || leaving) return;
    scene = await createScene(sceneHost, button, showFallback, stage => window.__moonBoot?.progress(stage));
    if (fallback || leaving) {
      scene.dispose();
      scene = undefined;
      return;
    }
    // 首帧已绘制后才开始拉开加载幕布；动画完成前维持 loading 和禁用按钮。
    await finishStartup();
  } catch (error) {
    if (!leaving) showFallback(error);
  }
}
// 主场景首帧与加载收尾之后再创建两个小画布，避免竞争启动阶段的 GPU 编译。
void initialize().then(async () => {
  if (leaving || window.__moonBoot?.failed) return;
  try {
    const { installEntryIcons } = await import("./entry-icons");
    // 超时守卫已经锁定静态页面时，迟到的图标模块也不能重新创建 WebGL 内容。
    // 用户已开始首个旅程时继续保留静态图标，避免装饰画布抢占首次开盖的 GPU 编译预算。
    if (!leaving && state.phase === "idle" && !window.__moonBoot?.failed) disposeEntryIcons = installEntryIcons(entrances);
  } catch (error) {
    console.warn("入口图标模块不可用，保留静态入口：", error);
  }
});
