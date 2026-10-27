import { pageConfig } from "./config.ts";
import { renderSealTitleLine, renderSealGlyphDefinitions } from "./title.ts";

/** 开发服务与生产构建共用 HTML 替换逻辑，不依赖浏览器入口模块执行。 */
export function renderStaticHtml(html: string, blogUrl: string): string {
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
  // 正文四行与入口文案恢复原生简体文本，标点、空格及既有样式保持原样。
  return html.replaceAll("__MOON_BLOG_URL__", () => escapedUrl)
    .replaceAll("__MOON_TITLE_FIRST__", () => renderSealTitleLine(pageConfig.titleLines[0]))
    .replaceAll("__MOON_TITLE_SECOND__", () => renderSealTitleLine(pageConfig.titleLines[1]))
    .replaceAll("__MOON_DESCRIPTION__", () => pageConfig.description.map(escapeHtml).join("<br />"))
    .replaceAll("__MOON_ENTRANCE__", () => escapeHtml(pageConfig.entranceLabel))
    // 加载提示恢复原生简体文本，逗号沿用原文，不改变加载层样式和动画。
    .replaceAll("__MOON_LOADING__", () => escapeHtml(pageConfig.loadingLabel))
    .replaceAll("__MOON_SEAL_GLYPHS__", () => renderSealGlyphDefinitions([
      ...pageConfig.titleLines, ...pageConfig.description, pageConfig.entranceLabel, pageConfig.loadingLabel,
    ]));
}
