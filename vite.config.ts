import { defineConfig } from "vite";
import { pageConfig } from "./src/config.ts";
import { renderStaticHtml } from "./src/static-html.ts";

// HTML 与浏览器模块从同一配置生成地址；无脚本或入口请求失败也使用实际博客地址。
export default defineConfig({
  plugins: [
    {
      name: "moon-static-blog-links",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => renderStaticHtml(html, pageConfig.blogUrl),
      },
    },
  ],
});
