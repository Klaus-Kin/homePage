import { defineConfig } from "vite";
import { pageConfig } from "./src/config.ts";
import { renderStaticHtml } from "./src/static-html.ts";
import { readFileSync } from "node:fs";
import { compactSvgPaths } from "./src/svg-path.ts";
import { inlinePageStyles } from "./src/first-paint.ts";

// 专句 SVG 在开发 HTML 转换和生产构建时内联；浏览器无需下载字体或额外的题词资源。
const inscriptionSvg = readFileSync(new URL("./src/assets/inscription.svg", import.meta.url), "utf8");

// HTML 与浏览器模块从同一配置生成地址；无脚本或入口请求失败也使用实际博客地址。
export default defineConfig({
  plugins: [
    {
      name: "moon-first-frame-preload",
      transformIndexHtml: {
        order: "post",
        handler(html, context) {
          const bundle = context.bundle;
          // 生产页面只有约 17KB 样式，直接内联消除首屏阻塞请求；开发态继续使用 Vite 样式热更新。
          const styles = new Map<string, string>();
          for (const output of Object.values(bundle ?? {})) {
            if (output.type === "asset" && output.fileName.endsWith(".css"))
              styles.set(`/${output.fileName}`, typeof output.source === "string" ? output.source : new TextDecoder().decode(output.source));
          }
          const files = new Set<string>();
          // 生产 HTML 提前发现主场景及其静态依赖，减少入口执行后才逐层请求的瀑布；不预取 Worker 回退模块。
          const visit = (file: string) => {
            if (files.has(file)) return;
            files.add(file);
            const output = bundle?.[file];
            if (output?.type === "chunk") output.imports.forEach(visit);
          };
          for (const output of Object.values(bundle ?? {}))
            if (output.type === "chunk" && output.name === "scene") visit(output.fileName);
          return { html: compactSvgPaths(bundle ? inlinePageStyles(html, styles) : html), tags: [...files].map(file => ({
            tag: "link", attrs: { rel: "modulepreload", href: `/${file}` }, injectTo: "head" as const,
          })) };
        },
      },
    },
    {
      name: "moon-static-blog-links",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => renderStaticHtml(html, pageConfig.blogUrl, inscriptionSvg),
      },
    },
  ],
});
