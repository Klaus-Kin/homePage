/** 宝盒从原近景位置后移一小段；保留实体比例，地面支撑、灯光和植被避让同步跟随。 */
export const chestPlacement = { x: 0.3, z: 6.9, scale: 0.64 } as const;

/** PC 单独后移并左移，手机沿用已确认的位置；两者使用同一个实体比例。 */
export type ChestPlacement = { readonly x: number; readonly z: number; readonly scale: number };
export const desktopChestPlacement = { x: -0.7, z: 5.5, scale: chestPlacement.scale } as const;
export function selectChestPlacement(mobile: boolean): ChestPlacement {
  return mobile ? chestPlacement : desktopChestPlacement;
}
