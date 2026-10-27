import { pageConfig } from "./config.ts";
import { renderSealTitleLine } from "./title.ts";

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
  const escapedUrl = blogUrl.replace(
    /[&"'<>]/g,
    (character) => entities[character],
  );
  // 回调返回字面字符串，防止地址中的 $& 等内容被当作替换模板展开。
  return html.replaceAll("__MOON_BLOG_URL__", () => escapedUrl)
    .replaceAll("__MOON_TITLE_FIRST__", () => renderSealTitleLine(pageConfig.titleLines[0]))
    .replaceAll("__MOON_TITLE_SECOND__", () => renderSealTitleLine(pageConfig.titleLines[1]));
}
