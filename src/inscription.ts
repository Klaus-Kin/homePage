import { scheduleStrokes, strokeProgress } from "./inscription-strokes";
import type { InscriptionFrame } from "./inscription-timeline";

/** 操作构建时已内联的 SVG，不下载字体、不解析字形，也不另建动画或计时循环。 */
export class Inscription {
  private root: HTMLElement;
  private pens: SVGPathElement[];
  private glyphs: { root: SVGSVGElement; full: SVGUseElement; end: number }[];
  private schedule: ReturnType<typeof scheduleStrokes>;
  private duration: number;
  private progress = -1;
  private opacity = -1;

  constructor(root: HTMLElement, duration: number) {
    this.root = root;
    this.duration = duration;
    this.pens = [...root.querySelectorAll<SVGPathElement>("[data-pen]")];
    const glyphs = [...root.querySelectorAll<SVGSVGElement>("[data-character]")];
    this.schedule = scheduleStrokes(this.pens.map(pen => {
      const glyph = pen.closest<SVGSVGElement>("[data-character]")!;
      return { length: Number(pen.dataset.length), character: glyphs.indexOf(glyph), comma: glyph.dataset.character === "," };
    }), duration);
    // 每个字写完即换为无拼缝的完整墨面，其他字继续逐笔显露；不等整句结束才修复局部抗锯齿接缝。
    this.glyphs = glyphs.map(glyph => ({ root: glyph, full: glyph.querySelector<SVGUseElement>("[data-complete]")!,
      end: this.schedule[this.pens.indexOf([...glyph.querySelectorAll<SVGPathElement>("[data-pen]")].at(-1)!)].end }));
  }

  render(frame: InscriptionFrame) {
    this.root.dataset.visible = String(frame.visible);
    this.root.dataset.mode = frame.mode;
    this.root.dataset.progress = String(frame.progress);
    this.root.dataset.complete = String(frame.complete);
    // 偏好切换期间保留已经画出的局部墨迹；完整字形从透明淡入，避免先擦掉半句。
    const changed = this.progress !== frame.progress;
    if (changed) {
      this.progress = frame.progress;
      this.pens.forEach((pen, i) => {
        const progress = strokeProgress(frame.progress * this.duration, this.schedule[i]);
        pen.setAttribute("stroke-dashoffset", String(1 - progress));
        pen.dataset.progress = String(progress);
      });
    }
    if (changed || this.opacity !== frame.opacity) {
      this.opacity = frame.opacity;
      this.glyphs.forEach(glyph => {
        const finished = frame.progress * this.duration >= glyph.end;
        glyph.root.dataset.finished = String(finished);
        glyph.full.setAttribute("opacity", String(finished ? 1 : frame.opacity));
      });
    }
  }
}
