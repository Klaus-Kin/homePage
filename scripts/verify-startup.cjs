// 延迟场景模块以稳定复现冷启动，检查旧截图不会在加载期间被拉伸展示。
async (page) => {
  const origin = new URL(page.url()).origin;
  const results = [];
  // 分别阻塞场景代码和月面纹理，覆盖桌面、手机的两类异步等待。
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1024, height: 1366 },
    { width: 390, height: 844 },
  ]) {
    for (const resource of ["module", "moon"]) {
      const context = await page.context().browser().newContext({ viewport });
      const target = await context.newPage();
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const pattern =
        resource === "module"
          ? /\/(?:src\/scene\.ts|assets\/scene-[^/]+\.js)(?:\?|$)/
          : "**/assets/moon-lroc.jpg";
      await target.route(pattern, async (route) => {
        await gate;
        await route.continue();
      });
      try {
        const requested = target.waitForRequest(pattern);
        await target.goto(origin, { waitUntil: "domcontentloaded" });
        await requested;
        await target.waitForTimeout(200);
        const loading = await target.evaluate(() => {
          const fallback = getComputedStyle(
            document.querySelector(".scene-fallback"),
          );
          // 检查最终可见性（含祖先），不能只看节点自身的 opacity。
          const visibleContent = [
            ".intro",
            "#scene",
          ].filter((selector) =>
            document
              .querySelector(selector)
              .checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true,
              }),
          );
          return {
            // 欢迎语只属于加载页，且必须排在金箍下方；不能仅检查文本是否存在。
            welcome: (() => {
              const label = document.querySelector('#moon-loader .loading-label');
              const rotor = document.querySelector('#moon-loader .hoop-rotor');
              return label.textContent === '月色正好，欢迎来访' &&
                label.checkVisibility({checkOpacity:true, checkVisibilityCSS:true}) &&
                label.getBoundingClientRect().top > rotor.getBoundingClientRect().bottom;
            })(),
            loaderVisible: document.querySelector("#moon-loader")?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
            rotation: getComputedStyle(document.querySelector("#moon-loader .hoop-rotor")).transform,
            state: document.querySelector("#app").dataset.state,
            fallbackVisible:
              fallback.display !== "none" &&
              fallback.visibility !== "hidden" &&
              fallback.opacity !== "0",
            visibleContent,
          };
        });
        // 慢速模块与纹理等待期间，金箍必须持续旋转而非只闪现一帧。
        await target.waitForTimeout(450);
        const nextRotation = await target.locator("#moon-loader .hoop-rotor").evaluate((el) => getComputedStyle(el).transform);
        if (!loading.loaderVisible || !loading.welcome || loading.rotation === nextRotation)
          throw new Error("加载金箍未显示或没有旋转");
        await target.screenshot({
          path: `output/playwright/startup-${viewport.width}-${resource}-loading.png`,
        });
        if (
          loading.state !== "loading" ||
          loading.fallbackVisible ||
          loading.visibleContent.length
        )
          throw new Error(
            `首屏尚未就绪便显示了部分内容：${JSON.stringify(loading)}`,
          );
        // 加载期间保留布局，但不允许 Tab 聚焦到尚未显示的入口。
        await target.keyboard.press("Tab");
        if (
          await target.evaluate(() =>
            document.querySelector("#app").contains(document.activeElement),
          )
        )
          throw new Error("加载中的隐藏入口仍可聚焦");
        release();
        await target.waitForSelector('#app[data-state="idle"]');
        if (await target.locator("#moon-loader").count()) throw new Error("首帧就绪后加载层未移除");
        for (const selector of [
          ".intro",
          "#scene",
          "#box-button",
        ]) {
          if (!(await target.locator(selector).isVisible()))
            throw new Error(`场景就绪后未显示 ${selector}`);
        }
        if (await target.locator('.brand, .night-note, .site-header').count() ||
            (await target.locator('body').textContent()).includes('月色正好，欢迎来访'))
          throw new Error('主页仍残留品牌或欢迎语');
        const sizes = [];
        for (let i = 0; i < 3; i++) {
          sizes.push(
            await target.evaluate(() => {
              const canvas = document.querySelector("canvas");
              return {
                width: canvas.clientWidth,
                height: canvas.clientHeight,
                ratio: canvas.width / canvas.height,
                box: document
                  .querySelector("#box-button")
                  .getBoundingClientRect()
                  .toJSON(),
              };
            }),
          );
          await target.waitForTimeout(200);
        }
        await target.screenshot({
          path: `output/playwright/startup-${viewport.width}-${resource}-ready.png`,
        });
        if (
          sizes.some(
            (s) =>
              s.width !== viewport.width ||
              s.height !== viewport.height ||
              Math.abs(s.ratio - viewport.width / viewport.height) > 0.002 ||
              Math.abs(s.box.x - sizes[0].box.x) > 0.1,
          )
        )
          throw new Error("首帧之后仍在修改画面比例或宝盒投影");
        results.push({ viewport, resource, loading, stableFirstFrame: true });
      } finally {
        // 即使断言失败，也释放网络门禁并关闭上下文，避免影响下一次运行。
        release();
        await context.close();
      }
    }
  }
  return results;
}
