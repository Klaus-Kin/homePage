import type { InkFrame } from "./ink-timeline";
import { canvasSize, inkGeometry, inkRadius } from "./ink-geometry";

/** 独立装饰层只消费主 RAF；不读取像素、不下载素材，也不接触 WebGL 生命周期。 */
export class InkTransition {
  private layer: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private buffer: HTMLCanvasElement;
  private shade: HTMLDivElement;
  private context: CanvasRenderingContext2D | null = null;
  private presentedContext: CanvasRenderingContext2D | null = null;
  private bufferWidth = 1;
  private bufferHeight = 1;
  private glyph: SVGSVGElement;
  private geometry = inkGeometry();
  // 单位方向与固定扰动只算一次，渗染逐帧不再分配采样点对象或计算三角函数。
  private boundary = this.geometry.edge.map((radius, i) => {
    const angle = i / 256 * Math.PI * 2, x = Math.cos(angle), y = Math.sin(angle);
    return { x: x * radius, y: y * radius, nx: x, ny: y };
  });
  private width = 1;
  private height = 1;
  private x = 0;
  private y = 0;
  private pool = 30;
  private coverage = 1;
  private active = false;
  private failed = false;
  private disposed = false;
  private lastFrame: InkFrame | null = null;

  constructor(glyph: SVGSVGElement) {
    this.glyph = glyph;
    this.layer = document.createElement("div");
    this.layer.id = "ink-transition";
    this.layer.setAttribute("aria-hidden", "true");
    this.layer.hidden = true;
    this.canvas = document.createElement("canvas");
    this.buffer = document.createElement("canvas");
    // 两张画布交替担任前台与备用，只有完整绘制成功才替换可见节点。
    this.canvas.dataset.inkSurface = this.buffer.dataset.inkSurface = "true";
    this.shade = document.createElement("div");
    this.shade.className = "ink-shade";
    this.layer.append(this.canvas, this.shade);
    document.body.append(this.layer);
  }

  get unavailable() { return this.failed; }

  /** 每次布局变化只重算字框、覆盖距离与画布预算，时间轴和随机形态保持不变。 */
  resize() {
    if (!this.active || this.disposed || this.lastFrame?.black) return;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const rect = this.glyph.getBoundingClientRect();
    this.x = Math.max(24, Math.min(this.width - 24, rect.left + rect.width * .85));
    this.y = Math.max(24, Math.min(this.height - 24, rect.top + rect.height * .72));
    this.pool = Math.max(18, Math.min(42, Math.min(this.width, this.height) * .055));
    this.coverage = Math.max(...[0, this.width].flatMap(x => [0, this.height].map(y => Math.hypot(x - this.x, y - this.y)))) / Math.min(...this.geometry.edge) + 12;
    // DOM 元数据用于浏览器验收落点与预算，逐帧不再读取布局。
    this.layer.dataset.origin = `${this.x},${this.y}`;
    if (!this.context || this.failed) return;
    try {
      // 两张画布合计仍受 250 万像素限制；重设尺寸也只操作备用画布，防止尺寸变化故障清空前台。
      const size = canvasSize(this.width, this.height, window.devicePixelRatio || 1, 2);
      this.bufferWidth = size.width;
      this.bufferHeight = size.height;
      if (this.lastFrame) this.drawAndPresent(this.lastFrame.elapsed);
    } catch (error) { this.fail(error, "resize"); }
  }

  /** 提交实心 CSS 黑底后才返回 true；画布故障保留最近墨迹并交给主时间轴淡黑。 */
  render(frame: InkFrame): boolean {
    if (this.disposed || frame.stage === "waiting") return false;
    if (!this.active) {
      this.active = true;
      this.layer.hidden = false;
      document.documentElement.classList.add("ink-transition-active");
      // 按需申请 2D 上下文，避免入口启动成本；减少动态不需要画布。
      if (frame.stage !== "fade") {
        try {
          this.context = this.buffer.getContext("2d");
          this.presentedContext = this.canvas.getContext("2d");
          if (!this.context || !this.presentedContext) throw new Error("Canvas 2D context unavailable");
        } catch (error) { this.fail(error, "initialize"); }
      }
      this.resize();
    }
    this.layer.dataset.stage = frame.stage;
    this.layer.dataset.elapsed = String(frame.elapsed);
    if (frame.black) {
      this.layer.dataset.black = "true";
      this.lastFrame = frame;
      return true;
    }
    // 淡黑时冻结最后一帧，不清空也不继续推进；旋转由 resize 重画同一时刻。
    if (frame.stage !== "fade" && this.context && !this.failed) {
      try { this.drawAndPresent(frame.elapsed); }
      catch (error) { this.fail(error, "render"); }
    }
    this.shade.style.opacity = String(frame.fade);
    this.lastFrame = frame;
    return false;
  }

  private fail(error: unknown, operation: string) {
    if (!this.failed) console.error(`[ink-transition] ${operation} failed; using 180ms black fade`, error);
    this.failed = true;
  }

  /** 先在备用画布完成整帧，再原子替换节点；清空、绘制或提交抛错均保留最后成功帧。 */
  private drawAndPresent(elapsed: number) {
    if (this.buffer.width !== this.bufferWidth) this.buffer.width = this.bufferWidth;
    if (this.buffer.height !== this.bufferHeight) this.buffer.height = this.bufferHeight;
    this.context!.setTransform(this.bufferWidth / this.width, 0, 0, this.bufferHeight / this.height, 0, 0);
    this.draw(elapsed);
    this.canvas.replaceWith(this.buffer);
    [this.canvas, this.buffer] = [this.buffer, this.canvas];
    [this.context, this.presentedContext] = [this.presentedContext, this.context];
  }

  /** 256 个固定角度叠加多尺度轮廓；外侧三层短距离渗边，内部保持实黑。 */
  private contour(radius: number, fringe: number) {
    const ctx = this.context!;
    ctx.beginPath();
    // 相邻采样点的中点作二次曲线端点，保留细部扰动又避免放大后的多边形折角。
    const first = this.boundary[0], previous = this.boundary[255];
    ctx.moveTo(this.x + (first.x + previous.x) * radius / 2 + (first.nx + previous.nx) * fringe / 2,
      this.y + (first.y + previous.y) * radius / 2 + (first.ny + previous.ny) * fringe / 2);
    for (let i = 0; i < 256; i++) {
      const current = this.boundary[i], next = this.boundary[(i + 1) % 256];
      ctx.quadraticCurveTo(this.x + current.x * radius + current.nx * fringe, this.y + current.y * radius + current.ny * fringe,
        this.x + (current.x + next.x) * radius / 2 + (current.nx + next.nx) * fringe / 2,
        this.y + (current.y + next.y) * radius / 2 + (current.ny + next.ny) * fringe / 2);
    }
    ctx.closePath(); ctx.fill();
  }

  /** 飞溅参数全部预生成；每滴到达固定落点后保留，直到被不断扩大的主体吞并。 */
  private draw(elapsed: number) {
    const ctx = this.context!;
    if (ctx.isContextLost()) throw new Error("Canvas 2D context lost");
    ctx.clearRect(0, 0, this.width, this.height);
    if (elapsed < 120) {
      const t = Math.max(0, elapsed / 120), distance = 1 - t;
      // 正面接近纸面：墨滴缩小并聚焦，投影收紧，避免像从画面上边缘掉下来的物体。
      ctx.fillStyle = `rgba(0,0,0,${.12 + t * .2})`;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, 8 + 27 * distance, 4 + 12 * distance, -.25, 0, Math.PI * 2); ctx.fill();
      const radius = 7 + 24 * distance * distance;
      ctx.fillStyle = "#030303";
      ctx.beginPath(); ctx.ellipse(this.x + distance * 5, this.y - distance * 15, radius, radius * 1.15, -.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(220,220,216,${.27 * distance})`;
      ctx.beginPath(); ctx.ellipse(this.x - radius * .3, this.y - distance * 15 - radius * .4, radius * .19, radius * .08, -.6, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const age = elapsed - 120;
    ctx.fillStyle = "#000";
    for (const filament of this.geometry.filaments) {
      const t = Math.min(1, age / 190), length = this.pool * filament.distance * (1 - Math.pow(1 - t, 3));
      // 从墨池内部拉出弯曲尖丝，末端收束成零宽度，不形成粗圆射线。
      ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(filament.angle);
      const base = this.pool * filament.width;
      ctx.beginPath(); ctx.moveTo(0, -base);
      ctx.quadraticCurveTo(length * .55, -base + length * filament.bend, length, length * filament.bend);
      ctx.quadraticCurveTo(length * .5, base + length * filament.bend, 0, base);
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    for (const drop of this.geometry.drops) {
      const t = Math.max(0, Math.min(1, (age - drop.delay) / drop.duration));
      if (t === 0) continue;
      const distance = this.pool * drop.distance * (1 - Math.pow(1 - t, 2));
      const hop = Math.sin(t * Math.PI) * this.pool * .45;
      const x = this.x + Math.cos(drop.angle) * distance, y = this.y + Math.sin(drop.angle) * distance - hop;
      ctx.beginPath(); ctx.ellipse(x, y, this.pool * drop.radius * (1 + (1 - t) * .9), this.pool * drop.radius / drop.stretch, drop.angle, 0, Math.PI * 2); ctx.fill();
    }
    const radius = inkRadius(elapsed, this.coverage, this.pool);
    for (const [fringe, alpha] of [[6, .08], [3.5, .16], [1.5, .3], [0, 1]]) {
      ctx.fillStyle = `rgba(0,0,0,${alpha})`; this.contour(radius, fringe);
    }
    // 只有撞击早期保留一点湿墨反射，浸染阶段不出现发亮的灰色墨池。
    if (age < 240) {
      ctx.strokeStyle = `rgba(155,158,151,${.22 * (1 - age / 240)})`;
      ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(this.x - radius * .15, this.y - radius * .25, radius * .45, radius * .2, -.3, Math.PI, Math.PI * 1.65); ctx.stroke();
    }
  }

  /** 离页释放独立图层和画布，不留下动画循环或外部监听器。 */
  dispose() {
    this.disposed = true;
    this.layer.remove();
    this.canvas.width = this.canvas.height = 1;
    this.buffer.width = this.buffer.height = 1;
    this.context = null;
    this.presentedContext = null;
    document.documentElement.classList.remove("ink-transition-active");
  }
}
