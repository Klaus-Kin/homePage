// 在生产预览或开发服务中验证白幕实际 DOM、重复点击、键盘、触摸与滑动取消。
async (page) => {
  const origin = new URL(page.url()).origin;
  const results = [];
  const browser = page.context().browser();
  async function scenario(name, options, activate) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      ...options,
    });
    const target = await context.newPage();
    const errors = [];
    target.on("pageerror", (error) => errors.push(error.message));
    let requests = 0,
      atNavigation;
    await target.exposeFunction("recordVisualState", (value) => {
      atNavigation = value;
    });
    await target.route("https://example.com/blog", async (route) => {
      requests++;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>Blog test destination</title><h1>Blog destination reached</h1>",
      });
    });
    await target.goto(origin);
    await target.waitForFunction(
      () => document.querySelector("#app").dataset.state === "idle",
    );
    await target.evaluate(() => {
      const observer = new MutationObserver(() => {
        const overlay = document.querySelector("#whiteout"),
          state = document.querySelector("#app").dataset.state;
        if (overlay.dataset.white === "true" && !window.__whiteAt)
          window.__whiteAt = performance.now();
        if (overlay.dataset.white !== "true") window.__whiteAt = null;
        // 导航停留必须从真实全黑提交后累计，不能用早已铺满的背景光幕代替。
        const ink = document.querySelector("#inscription");
        if (ink.dataset.complete === "true" && !window.__inkAt) window.__inkAt = performance.now();
        const black = document.querySelector('#ink-transition');
        if (black.dataset.black === "true" && !window.__blackAt) window.__blackAt = performance.now();
        if (state === "redirect")
          window.recordVisualState({
            opacity: getComputedStyle(overlay).opacity,
            // 各输入方式、降级和减少动态都应经过相同的淡黄完成态。
            veilColor: getComputedStyle(overlay).backgroundColor,
            white: overlay.dataset.white,
            state,
            whiteAt: window.__whiteAt,
            inkAt: window.__inkAt,
            complete: ink.dataset.complete,
            black: black.dataset.black,
            blackColor: getComputedStyle(black).backgroundColor,
            blackAt: window.__blackAt,
            now: performance.now(),
            rect: overlay.getBoundingClientRect().toJSON(),
            width: innerWidth,
            height: innerHeight,
          });
      });
      observer.observe(document.querySelector("#whiteout"), {
        attributes: true,
      });
      observer.observe(document.querySelector("#app"), { attributes: true });
      observer.observe(document.querySelector("#inscription"), { attributes: true });
      observer.observe(document.querySelector("#ink-transition"), { attributes: true });
    });
    const started = Date.now();
    await activate(target);
    await target.waitForURL("https://example.com/blog", { timeout: 15000 });
    const elapsed = Date.now() - started;
    if (
      requests !== 1 ||
      atNavigation.opacity !== "1" ||
      atNavigation.veilColor !== "rgb(255, 241, 199)" ||
      atNavigation.white !== "true" ||
      atNavigation.state !== "redirect" ||
      atNavigation.complete !== "true" ||
      atNavigation.black !== "true" ||
      atNavigation.blackColor !== "rgb(0, 0, 0)" ||
      atNavigation.now - atNavigation.blackAt < 159 ||
      errors.length
    )
      throw new Error(
        `${name}: ${JSON.stringify({ requests, atNavigation, errors })}`,
      );
    if (
      atNavigation.rect.width !== atNavigation.width ||
      atNavigation.rect.height !== atNavigation.height
    )
      throw new Error("Whiteout does not fill viewport");
    results.push({
      name,
      elapsed,
      requests,
      whiteHoldMs: Math.round(atNavigation.now - atNavigation.whiteAt),
      blackHoldMs: Math.round(atNavigation.now - atNavigation.blackAt),
      opacity: atNavigation.opacity,
      errors,
    });
    await context.close();
  }
  await scenario("mouse double click", {}, async (target) => {
    const button = target.getByRole("button", {
      name: "提示选择旅程入口",
    });
    const box = await button.boundingBox();
    await target.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await target.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (await target.locator("#app").getAttribute("data-state") !== "idle") throw new Error("宝盒误启动转场");
    await target.locator("[data-entrance=blog]").click();
    await target.waitForFunction(
      () => document.querySelector("#whiteout").dataset.white === "true",
    );
    await target.screenshot({
      path: "output/playwright/pure-white-before-navigation.png",
    });
  });
  // 从完整模型投影的中心点击大尺寸竖屏宝盒，验证构图修复后入口仍同步。
  await scenario(
    "portrait tablet chest click",
    { viewport: { width: 1024, height: 1366 }, reducedMotion: "reduce" },
    async (target) => {
      const bounds = await target
        .locator("#scene")
        .evaluate((element) => JSON.parse(element.dataset.boxBounds));
      await target.mouse.click(
        (bounds.left + bounds.right) / 2,
        (bounds.top + bounds.bottom) / 2,
      );
      await target.locator("[data-entrance=blog]").click();
    },
  );
  await scenario(
    "keyboard Enter",
    { viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" },
    async (target) => {
      await target
        .getByRole("button", { name: "提示选择旅程入口" })
        .focus();
      await target.keyboard.press("Enter");
      await target.locator("[data-entrance=blog]").press("Enter");
    },
  );
  await scenario(
    "keyboard Space",
    { reducedMotion: "reduce" },
    async (target) => {
      await target
        .getByRole("button", { name: "提示选择旅程入口" })
        .focus();
      await target.keyboard.press("Space");
      await target.locator("[data-entrance=blog]").press("Enter");
    },
  );
  await scenario(
    "touch swipe rejected, then tap",
    {
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      reducedMotion: "reduce",
    },
    async (target) => {
      // 移除可见提示后，触屏仍通过原生按钮语义与实际宝盒热点进入。
      if (await target.locator("#box-prompt, .box-caption").count()) throw new Error("盒底说明未移除");
      const box = await target.locator("#box-button").boundingBox();
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      const cdp = await target.context().newCDPSession(target);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + 50, y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      if ((await target.locator("#app").getAttribute("data-state")) !== "idle")
        throw new Error("Swipe activated box");
      const capped = await target.evaluate(
        () =>
          document.querySelector("canvas").width /
            document.querySelector("canvas").clientWidth <=
          1.51,
      );
      if (!capped) throw new Error("Mobile DPR cap failed");
      await target.touchscreen.tap(x, y);
      await target.locator("[data-entrance=blog]").tap();
    },
  );
  await scenario(
    "text entry link",
    { reducedMotion: "reduce" },
    async (target) => {
      await target.locator("[data-entrance=blog]").click();
    },
  );
  await scenario(
    "motion preference changes during whiteout",
    { reducedMotion: "reduce" },
    async (target) => {
      await target.locator("#box-button").focus();
      await target.keyboard.press("Enter");
      await target.locator("[data-entrance=blog]").press("Enter");
      await target.waitForFunction(
        () => document.querySelector("#whiteout").dataset.white === "true",
      );
      await target.emulateMedia({ reducedMotion: "no-preference" });
    },
  );
  await scenario(
    "hidden tab pauses transition",
    { reducedMotion: "reduce" },
    async (target) => {
      await target.locator("#box-button").focus();
      await target.keyboard.press("Enter");
      await target.locator("[data-entrance=blog]").press("Enter");
      await target.waitForTimeout(200);
      const before = await target.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        return document.querySelector("#whiteout").dataset.spread;
      });
      await target.waitForTimeout(300);
      const after = await target
        .locator("#whiteout")
        .evaluate((element) => element.dataset.spread);
      if (before !== after) throw new Error("Hidden transition advanced");
      await target.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
    },
  );
  return results;
}
