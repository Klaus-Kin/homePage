import { defineConfig } from "vite";
import { pageConfig } from "./src/config.ts";
import { renderStaticHtml } from "./src/static-html.ts";
import { readFileSync } from "node:fs";

// 专句 SVG 在开发 HTML 转换和生产构建时内联；浏览器无需下载字体或额外的题词资源。
const inscriptionSvg = readFileSync(new URL("./src/assets/inscription.svg", import.meta.url), "utf8");

// HTML 与浏览器模块从同一配置生成地址；无脚本或入口请求失败也使用实际博客地址。
export default defineConfig({
  plugins: [
    {
      name: "moon-static-blog-links",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => renderStaticHtml(html, pageConfig.blogUrl, inscriptionSvg),
      },
    },
  ],
});
