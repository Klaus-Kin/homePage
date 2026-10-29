import { pageConfig } from "./config.ts";
import { renderSealTitleLine, renderSealGlyphDefinitions } from "./title.ts";
import { renderCalligraphyCopy, renderCalligraphyGlyphDefinitions } from "./calligraphy.ts";

/** 开发服务与生产构建共用 HTML 替换逻辑，不依赖浏览器入口模块执行。 */
export function renderStaticHtml(html: string, blogUrl: string, inscriptionSvg = "", worldUrl: string = pageConfig.worldUrl): string {
  // 配置写入带引号的属性，必须转义 HTML 特殊字符，避免查询参数破坏链接结构。
  const entities: Record<string, string> = {
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
    "<": "&lt;",
    ">": "&gt;",
  };
  const escapeHtml = (text: string) => text.replace(
    /[&"'<>]/g,
    (character) => entities[character],
  );
  const escapedUrl = escapeHtml(blogUrl);
  // 回调返回字面字符串，防止地址中的 $& 等内容被当作替换模板展开。
  // 正文、入口与欢迎语共享题词行书；标点、空格及既有配色保持原样。
  return html.replaceAll("__MOON_BLOG_URL__", () => escapedUrl)
    .replaceAll("__MOON_WORLD_URL__", () => escapeHtml(worldUrl))
    .replaceAll("__MOON_INSCRIPTION__", () => inscriptionSvg)
    .replaceAll("__MOON_TITLE_FIRST__", () => renderSealTitleLine(pageConfig.titleLines[0]))
    .replaceAll("__MOON_TITLE_SECOND__", () => renderSealTitleLine(pageConfig.titleLines[1]))
    .replaceAll("__MOON_DESCRIPTION__", () => pageConfig.description.map(line => renderCalligraphyCopy(line)).join("<br />"))
    .replaceAll("__MOON_ENTRANCE__", () => renderCalligraphyCopy(pageConfig.entranceLabel))
    // 两段独立 SVG 只在手机换行；保留逗号及相邻原文，强制颜色模式也使用相同分行结构。
    .replaceAll("__MOON_WORLD__", () => pageConfig.worldLabel.split(/(?<=,)/)
      .map(part => `<span class="world-line">${renderCalligraphyCopy(part)}</span>`).join(""))
    // 欢迎语仍使用 24px 原金色，字形与其余静态行书共用，首屏不依赖字体请求或主模块执行。
    .replaceAll("__MOON_LOADING__", () => renderCalligraphyCopy(pageConfig.loadingLabel, true))
    .replaceAll("__MOON_SEAL_GLYPHS__", () => renderSealGlyphDefinitions(pageConfig.titleLines))
    .replaceAll("__MOON_CALLIGRAPHY_GLYPHS__", () => renderCalligraphyGlyphDefinitions([
      ...pageConfig.description, pageConfig.entranceLabel, pageConfig.worldLabel, pageConfig.loadingLabel,
    ]));
}
