// 通过 playwright-cli run-code --filename 执行，导出与正常渲染完全相同的静态风景。
async (page) => {
  const origin = new URL(page.url()).origin;
  const results = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 768, 1024],
    ["mobile", 390, 844],
    ["short", 844, 390],
    // 短竖屏不能裁切横屏图，否则月亮会落到标题后方；单独导出相同短屏相机的实际画面。
    ["short-portrait", 320, 480],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    await page.waitForFunction(
      () => document.querySelector("#app").dataset.state === "idle",
    );
    if (
      await page
        .locator("#app")
        .evaluate((el) => el.classList.contains("fallback"))
    )
      throw new Error("不能从降级图片再次生成降级图片");
    // 仅隐藏 HTML 文案，禁止修改相机、模型、灯光或画布内容。
    const style = await page.addStyleTag({
      content:
        // 截图保留最终场景像素，鼠标图层也必须隐藏，防止静态图烘入角落的金箍棒。
        ".fade-content, #box-button, .scene-fallback, .staff-cursor-layer { visibility: hidden !important; }",
    });
    await page
      .locator("#scene canvas")
      .screenshot({ path: `output/playwright/scene-${name}.png` });
    await style.evaluate((el) => el.remove());
    // 随最终静态图保存独立的投影证据，CSS 热点与恢复测试都使用同一轮导出的范围。
    const bounds = await page.locator("#scene").evaluate((el) => JSON.parse(el.dataset.boxBounds));
    const hitBounds = await page.locator("#box-button").boundingBox();
    results.push({ name, width, height, bounds, hitBounds });
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return results;
}
