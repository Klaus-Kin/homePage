/** Worker 只交换纯数据；请求编号由调用端分配，不把 WebGL、DOM 或资源所有权跨线程传递。 */
export interface MeadowJob {
  type: "meadow";
  kind: "turf" | "grass" | "long" | "seeds" | "flowers";
  mobile: boolean;
  seed: number;
  strength: number;
  ground: Float32Array;
  footprints: readonly (readonly { x: number; z: number }[])[];
}
export type TerrainJob = MeadowJob | { type: "mountain"; layer: number; mobile: boolean };
export interface MountainData {
  position: Float32Array; normal: Float32Array; uv: Float32Array; color: Float32Array;
  index: Uint16Array | Uint32Array;
}
export interface MeadowData {
  matrices: Float32Array; colors: Float32Array; count: number; baseCount: number;
  min: number[]; max: number[];
}
