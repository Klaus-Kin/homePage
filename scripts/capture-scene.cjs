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
        ".fade-content, #box-button, .scene-fallback { visibility: hidden !important; }",
    });
    await page
      .locator("canvas")
      .screenshot({ path: `output/playwright/scene-${name}.png` });
    await style.evaluate((el) => el.remove());
    results.push({ name, width, height });
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return results;
}
