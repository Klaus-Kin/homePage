export const INSCRIPTION_TEXT = "一念间,又是另一个世界";
export interface StrokeInput { length: number; character: number; comma: boolean }
export interface StrokeTiming { start: number; end: number }

/** 行笔按轨迹长度分时；笔间、字间与逗号停顿全部包含在传入的总时长内。 */
export function scheduleStrokes(strokes: readonly StrokeInput[], duration: number): StrokeTiming[] {
  if (!strokes.length || strokes.some(stroke => !Number.isFinite(stroke.length) || stroke.length <= 0))
    throw new Error("题词轨迹缺失或长度无效，无法安排书写时序");
  const pauses: number[] = strokes.map((stroke, i) => i === strokes.length - 1 ? 0 :
    stroke.character === strokes[i + 1].character ? 6 : stroke.comma ? 120 : 28);
  const drawingTime = duration - pauses.reduce((sum, pause) => sum + pause, 0);
  if (drawingTime <= 0) throw new Error("题词总时长不足以容纳笔间停顿");
  const length = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  let cursor = 0;
  return strokes.map((stroke, i) => {
    const start = cursor;
    const end = i === strokes.length - 1 ? duration : start + drawingTime * stroke.length / length;
    cursor = end + pauses[i];
    return { start, end };
  });
}

/** 局部遮罩只推进当前笔画；已完成的墨迹一直保留，尚未落笔的笔画保持完全隐藏。 */
export function strokeProgress(elapsed: number, timing: StrokeTiming): number {
  return Math.max(0, Math.min(1, (elapsed - timing.start) / (timing.end - timing.start)));
}
