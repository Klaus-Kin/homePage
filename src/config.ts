/** 页面文案、跳转目标和过渡时长统一维护；正式发布时只需替换博客地址。 */
export const pageConfig = {
  title: "程序猿的月光宝盒",
  titleLines: ["程序猿的", "月光宝盒"],
  description: ["开发者 · 写作者 · 时空旅人", "写代码也写故事", "此间有故事，亦有远方", "把热爱写进代码，把故事交给月光"],
  blogUrl: "https://example.com/blog",
  transition: { charge: 800, fade: 2000, hold: 400, reducedFade: 600 },
} as const;

/** 全屏构图采用固定预设；位置以视口比例维护，避免 CSS 与相机各自猜测。 */
export const sceneConfig = {
  layout: {
    desktop: {
      // 横向视点略向右移，让更近的宝盒向画面中间靠拢，并保留完整右端。
      cameraX: -3.7,
      distance: 14.5,
      height: 4.0,
      targetY: 3.3,
      fov: 42,
      moon: [0.79, 0.24, 0.12],
    },
    tablet: {
      cameraX: -1.8,
      distance: 18,
      height: 5.0,
      targetY: 4.1,
      fov: 44,
      moon: [0.79, 0.19, 0.085],
    },
    mobile: {
      cameraX: -0.1,
      distance: 16,
      height: 4.7,
      targetY: 3.7,
      fov: 44,
      moon: [0.79, 0.145, 0.055],
    },
    short: {
      cameraX: -4.6,
      distance: 14,
      height: 3.6,
      targetY: 2.8,
      fov: 42,
      moon: [0.79, 0.25, 0.1],
    },
  },
  // 构图与画质分开选择：大尺寸竖屏仍采用居中的平板相机，不因宽度大而偏到右侧。
  layoutRules: {
    mobileWidth: 768,
    desktopWidth: 1024,
    shortHeight: 500,
    desktopAspect: 4 / 3,
  },
  quality: {
    desktop: {
      pixelRatio: 1.75,
      shadowSize: 1024,
      grass: 15000,
      clouds: 30,
      stars: 2000,
      rocks: 90,
      flowers: 160,
    },
    mobile: {
      pixelRatio: 1.5,
      shadowSize: 512,
      grass: 5000,
      clouds: 10,
      stars: 700,
      rocks: 40,
      flowers: 55,
    },
  },
} as const;

/** 桌面左右构图至少需要 4:3 的横向空间，近方形及竖屏改用平板构图。 */
export function selectSceneLayout(
  width: number,
  height: number,
): keyof typeof sceneConfig.layout {
  const rules = sceneConfig.layoutRules;
  if (height < rules.shortHeight) return "short";
  if (width < rules.mobileWidth) return "mobile";
  return width < rules.desktopWidth || width / height < rules.desktopAspect
    ? "tablet"
    : "desktop";
}
