// 不依赖测试专用 URL 参数：在浏览器边界模拟资源失败、禁用 WebGL 和运行中上下文丢失。
async (page) => {
  const origin = new URL(page.url()).origin;
  const browser = page.context().browser(),
    results = [];
  for (const kind of [
    "no-webgl",
    "asset-failure",
    "moon-failure",
    "context-lost",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const target = await context.newPage();
    // 新月面资产失败同样进入可访问降级，不能留下没有纹理的占位球。
    if (kind === "moon-failure")
      await target.route("**/assets/moon-lroc.jpg", (route) => route.abort());
    if (kind === "no-webgl")
      await target.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return /webgl/i.test(type) ? null : get.call(this, type, ...args);
        };
      });
    if (kind === "asset-failure")
      // 现在材质均为本地程序纹理，资源失败针对动态场景模块，而非已移除的岩石图片。
      await target.route(
        /\/(?:src\/scene\.ts|assets\/scene-[^/]+\.js)(?:\?|$)/,
        (route) => route.abort(),
      );
    await target.route("https://example.com/blog", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Fallback destination reached</h1>",
      }),
    );
    await target.goto(origin);
    await target.waitForFunction(
      () => document.querySelector("#app").dataset.state === "idle",
    );
    if (kind === "context-lost")
      await target.evaluate(() =>
        document
          .querySelector("canvas")
          .getContext("webgl2")
          .getExtension("WEBGL_lose_context")
          .loseContext(),
      );
    await target.waitForFunction(() =>
      document.querySelector("#app").classList.contains("fallback"),
    );
    // 初始化失败与运行期上下文丢失都必须退出加载层，保留静态入口可点击。
    if (await target.locator("#moon-loader").count()) throw new Error(`${kind}: 加载层未移除`);
    await target.screenshot({ path: `output/playwright/${kind}.png` });
    await target
      .getByRole("button", { name: "提示选择旅程入口" })
      .click();
    if (await target.locator("#app").getAttribute("data-state") !== "idle") throw new Error("降级宝盒误启动转场");
    await target.locator("[data-entrance=blog]").click();
    await target.waitForURL("https://example.com/blog");
    results.push({ kind, staticEntryWorks: true });
    await context.close();
  }
  // 无脚本场景必须验证实际背景资源和布局，避免 display:block 掩盖样式未加载。
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      javaScriptEnabled: false,
    });
    try {
      const target = await context.newPage();
      await target.route("https://example.com/blog", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<h1>No-script destination reached</h1>",
        }),
      );
      await target.goto(origin);
      const staticPage = await target.evaluate(async () => {
        const fallback = document.querySelector(".scene-fallback");
        const background = getComputedStyle(fallback).backgroundImage;
        const url = background.match(/url\(["']?(.*?)["']?\)/)?.[1];
        const image = new Image();
        if (url) {
          image.src = url;
          await image.decode();
        }
        return {
          visible: fallback.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }),
          background,
          decoded: image.naturalWidth > 0,
          width: document.querySelector("#app").clientWidth,
          height: document.querySelector("#app").clientHeight,
          overflow:
            document.documentElement.scrollWidth > innerWidth ||
            document.documentElement.scrollHeight > innerHeight,
        };
      });
      if (
        !staticPage.visible ||
        !staticPage.decoded ||
        staticPage.width !== viewport.width ||
        staticPage.height !== viewport.height ||
        staticPage.overflow
      )
        throw new Error(
          `禁用脚本后静态场景或样式未正确加载：${JSON.stringify(staticPage)}`,
        );
      await target.screenshot({
        path: `output/playwright/javascript-disabled-${viewport.width}.png`,
      });
      if (!(await target.locator("#page-title").isVisible()))
        throw new Error("No-JS title missing");
      if (!(await target.getByRole("link", { name: "进入博客 →" }).isVisible()))
        throw new Error("No-JS entry missing");
      await target.getByRole("link", { name: "进入博客 →" }).click();
      await target.waitForURL("https://example.com/blog");
      results.push({
        kind: "javascript-disabled",
        viewport,
        staticPage,
        staticEntryWorks: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
