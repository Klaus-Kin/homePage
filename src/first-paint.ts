/** 将构建产物的页面样式直接放入 HTML，避免新标签的首次绘制等待另一条 CSS 网络请求。 */
export function inlinePageStyles(html: string, styles: ReadonlyMap<string, string>): string {
  return html.replace(/<link\b[^>]*>/g, tag => {
    if (!/\brel="stylesheet"/.test(tag)) return tag;
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    const css = href && styles.get(href);
    // 构建配置变动导致找不到样式时直接失败，防止生成表面成功、实际仍闪白的页面。
    if (css === undefined) throw new Error(`首屏样式未找到构建产物：${href ?? tag}`);
    return `<style data-page-styles>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
  });
}
