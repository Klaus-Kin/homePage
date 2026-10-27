// 拦截入口及静态依赖，并从截图中的宝盒位置点击，覆盖主模块完全不可用的边界。
async (page) => {
  const origin = new URL(page.url()).origin;
  const browser = page.context().browser();
  const results = [];
  const entryPattern = /\/(?:src\/main\.ts|assets\/index-[^/]+\.js)(?:\?|$)/;
  const scenePattern = /\/(?:src\/scene\.ts|assets\/scene-[^/]+\.js)(?:\?|$)/;
  const moonPattern = "**/assets/moon-lroc.jpg";
  async function destination(target) {
    await target.route("https://example.com/blog", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Recovery destination reached</h1>",
      }),
    );
  }
  // 错误事件应立即恢复入口；超时与迟到资源使用浏览器时钟验证，无须真实等待十秒。
  for (const kind of [
    "entry-failure",
    "dependency-failure",
    "runtime-failure",
    "late-entry",
    "late-scene",
    "late-moon",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    try {
      const target = await context.newPage();
      await destination(target);
      await target.clock.install();
      const late = kind.startsWith("late-");
      const pattern =
        kind === "late-moon"
          ? moonPattern
          : kind === "late-scene"
            ? scenePattern
            : entryPattern;
      if (kind === "dependency-failure") {
        // 开发模式拦截真实静态依赖；生产包无分离的静态依赖，替换入口以模拟同一模块图失败。
        await target.route(/\/src\/config\.ts(?:\?|$)/, (route) =>
          route.abort(),
        );
        await target.route("**/__recovery-dependency__.js", (route) =>
          route.abort(),
        );
        await target.route(entryPattern, (route) =>
          route.request().url().includes("/src/")
            ? route.continue()
            : route.fulfill({
                contentType: "text/javascript",
                body: 'import "/__recovery-dependency__.js";',
              }),
        );
      } else {
        await target.route(pattern, async (route) => {
          if (late) {
            await gate;
            await route.continue();
          } else if (kind === "runtime-failure")
            await route.fulfill({
              contentType: "text/javascript",
              body: 'throw new Error("Simulated startup exception");',
            });
          else await route.abort();
        });
      }
      const requested = target.waitForRequest(pattern);
      await target.goto(origin, { waitUntil: "commit" });
      await requested;
      await target.waitForFunction(() => Boolean(window.__moonBoot));
      if (late) await target.clock.runFor(10100);
      await target.waitForSelector("#app.boot-failed", { timeout: 2000 });
      if (
        !(await target.locator("[data-entrance]").isVisible()) ||
        !(await target.locator("#static-box").isVisible())
      )
        throw new Error(`${kind}: 未恢复可见原生入口`);
      if (late) {
        release();
        await target.waitForLoadState("networkidle");
        await target.waitForTimeout(150);
      }
      const recovered = await target.evaluate(() => ({
        locked: window.__moonBoot.failed,
        fallback: document.querySelector("#app").classList.contains("fallback"),
        state: document.querySelector("#app").dataset.state,
        canvases: document.querySelectorAll("canvas").length,
        loaders: document.querySelectorAll("#moon-loader").length,
      }));
      if (
        !recovered.locked ||
        !recovered.fallback ||
        recovered.state !== "idle" ||
        recovered.canvases || recovered.loaders
      )
        throw new Error(
          `${kind}: 迟到的初始化覆盖静态页面或未释放画布 ${JSON.stringify(recovered)}`,
        );
      await target.screenshot({
        path: `output/playwright/recovery-${kind}.png`,
      });
      // 同时验证静态文字链接和图片上的宝盒链接，二者均不依赖主模块的处理器。
      await target
        .locator(kind === "late-moon" ? "#static-box" : "[data-entrance]")
        .click();
      await target.waitForURL("https://example.com/blog");
      results.push({ scenario: kind, recovered, nativeEntryWorks: true });
    } catch (error) {
      throw new Error(`${kind}: ${error.message}`);
    } finally {
      release();
      await context.close();
    }
  }

  // 下列点取自源截图中的宝盒中心，独立于页面按钮样式，防止测到错误按钮自身仍判通过。
  const shots = {
    desktop: { width: 1920, height: 1080, x: 1424.476563, y: 984.531250, bottom: 1065.312500, right: 1636.140625 },
    tablet: { width: 768, height: 1024, x: 495.195313, y: 909.140625, bottom: 965.062500, right: 632.015625 },
    mobile: { width: 390, height: 844, x: 222.687500, y: 767.210938, bottom: 828.937500, right: 375.625000 },
    short: { width: 844, height: 390, x: 723.648438, y: 333.085938, bottom: 374.875000, right: 828.875000 },
  };
  // 由源图坐标独立计算水平和垂直裁切；同时限制平面边缘，避免为留白而露出底部空带。
  function fallbackPoint(shot, width, height) {
    const scale=Math.max(width/shot.width,height/shot.height);
    const left=Math.max(width-shot.width*scale,Math.min((width-shot.width*scale)/2,width-24-shot.right*scale));
    const top=Math.max(height-shot.height*scale,Math.min((height-shot.height*scale)/2,height-24-shot.bottom*scale));
    return {x:left+shot.x*scale,y:top+shot.y*scale};
  }
  const sizes = [
    [1920, 1080],
    [1366, 768],
    [768, 1024],
    [1024, 1366],
    [1280, 1600],
    [1440, 1920],
    [1024, 1024],
    [1023, 768],
    [800, 600],
    [960, 600],
    [1024, 768],
    [360, 800],
    [390, 844],
    [393, 852],
    [430, 932],
    [480, 1040],
    [844, 390],
    [1023, 768],
  ];
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      javaScriptEnabled,
      reducedMotion: "reduce",
    });
    try {
      const target = await context.newPage();
      await destination(target);
      if (javaScriptEnabled)
        await target.route(scenePattern, (route) => route.abort());
      await target.goto(origin);
      if (javaScriptEnabled) await target.waitForSelector("#app.fallback");
      if (await target.locator("#moon-loader").isVisible()) throw new Error("降级或禁用脚本时加载层仍可见");
      const layouts = [];
      for (const [width, height] of sizes) {
        await target.setViewportSize({ width, height });
        const name =
          height < 500
            ? "short"
            : width < 768
              ? "mobile"
              : width <= height
                ? "tablet"
                : "desktop";
        const shot = shots[name];
        const point = fallbackPoint(shot,width,height);
        await target.waitForTimeout(100);
        const layout = await target.evaluate(
          ({ point, name, javaScriptEnabled }) => {
            const expectedId = javaScriptEnabled ? "box-button" : "static-box";
            const hit = document.elementFromPoint(point.x, point.y);
            const button = document
              .querySelector(`#${expectedId}`)
              .getBoundingClientRect();
            const image = getComputedStyle(
              document.querySelector(".scene-fallback"),
            ).backgroundImage;
            const plane = document
              .querySelector(".scene-fallback")
              .getBoundingClientRect();
            return {
              hit: hit?.id === expectedId,
              minSize: button.width >= 44 && button.height >= 44,
              imageMatches: image.includes(`scene-${name}.webp`),
              planeCovers: plane.top <= 0 && plane.bottom >= innerHeight && plane.left <= 0 && plane.right >= innerWidth,
              buttonVisible: button.top >= 0 && button.bottom <= innerHeight && button.left >= 0 && button.right <= innerWidth,
              // 正常脚本与无脚本页面均彻底移除指定说明和右下装饰符号。
              notesRemoved: !document.querySelector(".box-caption, .site-footer, #box-prompt"),
            };
          },
          { point, name, javaScriptEnabled },
        );
        if (
          !layout.hit ||
          !layout.minSize ||
          !layout.imageMatches ||
          !layout.planeCovers ||
          !layout.buttonVisible ||
          !layout.notesRemoved
        )
          throw new Error(
            `降级布局 ${width}x${height} JS=${javaScriptEnabled}: ${JSON.stringify({ point, layout })}`,
          );
        layouts.push({ width, height, image: name, ...layout });
        if ((width === 1023 && height === 768) || (width === 1024 && height === 1024))
          await target.screenshot({
            path: `output/playwright/recovery-tablet-${width === height ? "square" : "landscape"}-${javaScriptEnabled}.png`,
          });
      }
      const point = fallbackPoint(shots.desktop,1023,768);
      await target.mouse.click(
        point.x,
        point.y,
      );
      await target.waitForURL("https://example.com/blog");
      results.push({
        scenario: javaScriptEnabled
          ? "scene-fallback-rotation"
          : "no-script-rotation",
        layouts,
        actualChestClickWorks: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
