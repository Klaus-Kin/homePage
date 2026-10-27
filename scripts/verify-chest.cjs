// 验证真实转轴、光圈起点与六种尺寸；虚拟时钟控制生产 RAF，不注入场景修改接口。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const [name, width, height] of [["ultrawide",3440,1440],["wide",2560,1080],["desktop",1920,1080],["mobile",390,844],["tablet",768,1024],["short",844,390]]) {
    const context = await page.context().browser().newContext({ viewport: { width, height } });
    try {
      const target = await context.newPage(), errors = [];
      target.on("pageerror", error => errors.push(error.message));
      await target.clock.install();
      await target.clock.pauseAt(new Date(Date.now() + 1000));
      let navigations = 0;
      await target.route("https://example.com/blog", async route => {
        navigations++;
        await route.fulfill({ contentType: "text/html", body: "<h1>到达博客</h1>" });
      });
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]');
      await target.clock.runFor(32);
      async function sample(stage) {
        const data = await target.evaluate(() => {
          const scene = document.querySelector("#scene"), overlay = document.querySelector("#whiteout");
          const bounds = JSON.parse(scene.dataset.boxBounds);
          return { angle: +scene.dataset.lidAngle, bounds,
            rotation: JSON.parse(scene.dataset.openingRotation),
            height: JSON.parse(scene.dataset.chestHeight),
            source: JSON.parse(scene.dataset.lightSource),
            center: { x: parseFloat(overlay.style.getPropertyValue("--light-x")), y: parseFloat(overlay.style.getPropertyValue("--light-y")) },
            spread: +(overlay.dataset.spread || 0), white: overlay.dataset.white === "true",
            // 字段名保持兼容既有门禁；完成态实际应是用户要求的淡黄不透明光幕。
            veilColor: getComputedStyle(overlay).backgroundColor,
            veilOpacity: getComputedStyle(overlay).opacity,
            visible: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
            shadowMoving: scene.dataset.shadowMoving === "true",
          };
        });
        if (!data.visible) throw new Error(`${name}/${stage}: 模型被裁切 ${JSON.stringify(data)}`);
        if (data.rotation[0] !== 0 || data.rotation[1] !== 0 ||
            Math.abs(data.height[0] + 0.03) > 1e-8 || data.height[1] < 0.64 - 1e-8)
          throw new Error(`${name}/${stage}: 上盖未沿水平轴垂直上翻 ${JSON.stringify(data)}`);
        const capture = await target.screenshot({ path: `output/playwright/chest-${name}-${stage}.png` });
        if (stage === "open" || stage === "white") {
          // 读取实际截图像素，防止仅改变材质色值后，叠加高亮仍把盒口渲染成纯白。
          const pixels = await target.evaluate(async ({ uri, area, stage, width }) => {
            const image = new Image(); image.src = uri; await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
            const scale = image.width / width;
            const bounds = stage === "white" ? [0, 0, image.width, image.height] : [
              Math.max(0, Math.floor(area.left * scale)), Math.max(0, Math.floor(area.top * scale)),
              Math.ceil((area.right - area.left) * scale), Math.ceil((area.bottom - area.top) * scale),
            ];
            const rgba = ctx.getImageData(...bounds).data;
            let warm = 0, white = 0, veilMismatch = 0;
            for (let i = 0; i < rgba.length; i += 4) {
              if (rgba[i] > 150 && rgba[i + 1] > 100 && rgba[i] - rgba[i + 2] > 20) warm++;
              if (rgba[i] > 245 && rgba[i + 1] > 245 && rgba[i + 2] > 245) white++;
              if (rgba[i] !== 255 || rgba[i + 1] !== 241 || rgba[i + 2] !== 199 || rgba[i + 3] !== 255) veilMismatch++;
            }
            return { warm, white, veilMismatch };
          }, { uri: `data:image/png;base64,${capture.toString("base64")}`, area: data.bounds, stage, width });
          if (stage === "open" && (pixels.warm < 10 || pixels.white > Math.max(5, pixels.warm * 0.01)))
            throw new Error(`${name}: 盒口亮部丢失淡金色 ${JSON.stringify(pixels)}`);
          if (stage === "white" && pixels.veilMismatch)
            throw new Error(`${name}: 完整光幕有非淡黄像素 ${JSON.stringify(pixels)}`);
          data.lightPixels = pixels;
        }
        return data;
      }
      const idle = await sample("idle");
      if (Math.abs(idle.angle) > 0.01 || Math.abs(idle.height[1] - 1.25) > 1e-8)
        throw new Error("待机应完全闭合，上下半盒叠合");
      await target.locator("#box-button").focus();
      await target.keyboard.press("Enter");
      await target.clock.runFor(432);
      const opening = await sample("opening");
      if (opening.angle < 85 || opening.angle > 110 || opening.height[1] < 4.4 ||
          opening.spread !== 0 || !opening.shadowMoving)
        throw new Error(`开盖时序错误 ${JSON.stringify(opening)}`);
      // 恰好落在八百毫秒展开终点，截图不让后续屏幕光圈遮住两条内槽。
      await target.clock.runFor(400);
      const open = await sample("open");
      if (Math.abs(open.angle - 180) > 0.01 || Math.abs(open.height[1] - 0.64) > 1e-8 || open.shadowMoving)
        throw new Error("上翻展开终点或阴影状态错误");
      await target.clock.runFor(992);
      const spread = await sample("spread");
      if (spread.spread < 0.45 || spread.spread > 0.6 || spread.white ||
          Math.hypot(spread.center.x - spread.source.x, spread.center.y - spread.source.y) > 1)
        throw new Error(`光圈未从盒口向外扩散 ${JSON.stringify(spread)}`);
      await target.clock.runFor(1040);
      const white = await sample("white");
      if (!white.white || navigations) throw new Error("光幕完整遮盖前导航或完成态未呈现");
      if (white.veilColor !== "rgb(255, 241, 199)" || white.veilOpacity !== "1")
        throw new Error(`淡黄光幕颜色或遮盖强度错误 ${JSON.stringify(white)}`);
      await target.clock.runFor(250);
      if (navigations) throw new Error("完整光幕停留不足四百毫秒");
      await target.clock.runFor(200);
      await target.waitForURL("https://example.com/blog");
      if (navigations !== 1 || errors.length) throw new Error(JSON.stringify({ navigations, errors }));
      results.push({ name, idle, opening, open, spread, white, navigations, errors });
    } finally { await context.close(); }
  }
  // 减少动态仍从盒口扩散淡黄光，但盖子不动、光束关闭；中途旋转也须重新投影光源。
  const context = await page.context().browser().newContext({
    viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
  });
  try {
    const target = await context.newPage();
    await target.clock.install();
    await target.clock.pauseAt(new Date(Date.now() + 1000));
    await target.goto(origin);
    await target.waitForSelector('#app[data-state="idle"]');
    await target.locator("#box-button").focus();
    await target.keyboard.press("Enter");
    await target.clock.runFor(320);
    await target.setViewportSize({ width: 844, height: 390 });
    await target.clock.runFor(32);
    const reduced = await target.evaluate(() => {
      const scene = document.querySelector("#scene"), overlay = document.querySelector("#whiteout");
      const source = JSON.parse(scene.dataset.lightSource);
      return { angle: +scene.dataset.lidAngle, beams: scene.dataset.beamsVisible,
        spread: +overlay.dataset.spread, source,
        x: parseFloat(overlay.style.getPropertyValue("--light-x")),
        y: parseFloat(overlay.style.getPropertyValue("--light-y")) };
    });
    if (reduced.angle !== 0 || reduced.beams !== "false" || reduced.spread <= 0 || reduced.spread >= 1 ||
        Math.hypot(reduced.source.x - reduced.x, reduced.source.y - reduced.y) > 1)
      throw new Error(`减少动态或旋转后的光源错误 ${JSON.stringify(reduced)}`);
    await target.screenshot({ path: "output/playwright/chest-reduced-rotated.png" });
    results.push({ reducedMotionAndRotation: reduced });
  } finally { await context.close(); }
  return results;
}
