export type CursorKind = "staff" | "point" | "grab";

/** 共享图层与原生回退的资源和热点；热点落在棒头、伸出指尖、抓取指腹上。 */
export const CURSOR_STYLES = {
  staff: { source: "/assets/cursor-staff.png", nativeSource: "/assets/cursor-staff-native.png", x: 6, y: 6 },
  point: { source: "/assets/cursor-point.png", nativeSource: "/assets/cursor-point-native.png", colorSource: "/assets/cursor-point-color.png", x: 10, y: 6 },
  grab: { source: "/assets/cursor-grab.png", nativeSource: "/assets/cursor-grab-native.png", colorSource: "/assets/cursor-grab-color.png", x: 25, y: 22 },
} as const;

/** closest 覆盖入口的图标、中文、英文和留白；禁用或离开目标后立即回到全局金箍棒。 */
export function cursorKindForTarget(target: { closest(selector: string): unknown } | null): CursorKind {
  if (target?.closest("#box-button:not(:disabled), #static-box")) return "grab";
  if (target?.closest(".journey-link:not([aria-disabled='true'])")) return "point";
  return "staff";
}
