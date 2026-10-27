// 通过 playwright-cli run-code --filename 调用，检查布局、真实浏览器帧率并保存验收截图。
async (page) => {
  const origin = new URL(page.url()).origin;
  const sizes = [
    [1920, 1080],
    [1366, 768],
    [768, 1024],
    [1024, 1366],
    [1280, 1600],
    [1440, 1920],
    [1024, 1024],
    [1280, 1024],
    [1366, 1024],
    [360, 800],
    [390, 844],
    [393, 852],
    [430, 932],
    [480, 1040],
    [844, 390],
    [640, 600],
    [320, 480],
    [1100, 1000],
  ];
  const results = [];
  await page.bringToFront();
  await page.goto(origin);
  await page.waitForFunction(
    () => document.querySelector("#app").dataset.state === "idle",
  );
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    // 多上下文检查后标签页可能被后台节流，等待真实 resize 提交，避免读取上一种尺寸。
    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      return canvas?.clientWidth === innerWidth && Math.abs(canvas.clientHeight - innerHeight) < 1;
    });
    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        };
      };
      const title = rect(".intro"),
        box = rect("#box-button"),
        model = JSON.parse(document.querySelector("#scene").dataset.boxBounds),
        moon = (() => {
          const b = JSON.parse(
            document.querySelector("#scene").dataset.moonBounds,
          );
          return {
            x: b.left,
            y: b.top,
            right: b.right,
            bottom: b.bottom,
            width: b.right - b.left,
            height: b.bottom - b.top,
          };
        })(),
        canvas = rect("canvas");
      const overlaps = (a, b) =>
        a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      // 整组上移后，首行与月亮可以并排；检查真实文字片段，避免把容器的空白区当成遮挡。
      const textRects = [];
      const walker = document.createTreeWalker(document.querySelector('.intro'), NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        textRects.push(...Array.from(range.getClientRects(), r => ({x:r.x,y:r.y,right:r.right,bottom:r.bottom})));
      }
      // 月亮是圆形投影，外接矩形的左下角为空白；文字不能接触月面本身。
      // 标题已改为同源小篆 SVG，必须检查实际图形，不能只检查辅助技术的隐藏文本。
      textRects.push(...Array.from(document.querySelectorAll('.seal-title'), el => {
        const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }));
      const overlapsMoon = r => {
        const cx=(moon.x+moon.right)/2, cy=(moon.y+moon.bottom)/2;
        const x=Math.max(r.x,Math.min(r.right,cx)), y=Math.max(r.y,Math.min(r.bottom,cy));
        return ((x-cx)/(moon.width/2))**2 + ((y-cy)/(moon.height/2))**2 < 1;
      };
      return {
        title,
        box,
        model,
        modelVisible:
          model.left >= 0 &&
          model.right <= innerWidth &&
          model.top >= 0 &&
          model.bottom <= innerHeight,
        moon,
        canvas,
        overflow: document.documentElement.scrollWidth > innerWidth,
        boxVisible:
          box.x >= 0 &&
          box.right <= innerWidth &&
          box.y >= 0 &&
          box.bottom <= innerHeight,
        titleOverlap: overlaps(title, box),
        titleMoonOverlap: textRects.some(overlapsMoon),
        moonVisible:
          moon.x >= 0 &&
          moon.right <= innerWidth &&
          moon.y >= 0 &&
          moon.bottom <= innerHeight,
        fullScreen:
          canvas.width === innerWidth &&
          Math.abs(canvas.height - visualViewport.height) < 1,
        moonOverlap: overlaps(moon, box),
        buttonSize: box.width >= 44 && box.height >= 44,
        state: document.querySelector("#app").dataset.state,
        // 文案在每种构图中都必须一致，移除的说明不能因响应式分支重新出现。
        copyUpdated: document.querySelector(".description").textContent.replace(/\s/g, "") ===
          "开发者·写作者·时空旅人写代码也写故事此间有故事，亦有远方把热爱写进代码，把故事交给月光",
        notesRemoved: !document.querySelector(".box-caption, .site-footer, #box-prompt, .brand, .night-note, .site-header"),
      };
    });
    if (
      layout.overflow ||
      !layout.boxVisible ||
      !layout.modelVisible ||
      layout.titleOverlap ||
      layout.titleMoonOverlap ||
      !layout.moonVisible ||
      !layout.fullScreen ||
      layout.moonOverlap ||
      !layout.buttonSize || !layout.copyUpdated || !layout.notesRemoved
    )
      throw new Error(
        `Layout failed ${width}x${height}: ${JSON.stringify(layout)}`,
      );
    await page.screenshot({ path: `output/playwright/${width}x${height}.png` });
    results.push({ viewport: `${width}x${height}`, passed: true, layout });
  }
  // 连续改变可视高度，模拟旋转与移动地址栏收缩后的画布适配。
  await page.setViewportSize({ width: 390, height: 720 });
  await page.setViewportSize({ width: 390, height: 844 });
  // resize 事件在浏览器下一帧派发，等待真实布局稳定后再作断言。
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector("#app").getBoundingClientRect().height -
          visualViewport.height,
      ) < 1,
  );
  const resized = await page.evaluate(
    () =>
      Math.abs(
        document.querySelector("#app").getBoundingClientRect().height -
          visualViewport.height,
      ) < 1,
  );
  if (!resized) throw new Error("Visual viewport height mismatch");
  await page.setViewportSize({ width: 1366, height: 768 });
  const performance = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const intervals = [];
        let previous = 0,
          start = 0;
        const frame = (now) => {
          if (!start) start = now;
          if (previous) intervals.push(now - previous);
          previous = now;
          if (now - start < 2500) requestAnimationFrame(frame);
          else {
            const gl = document.querySelector("canvas").getContext("webgl2"),
              extension = gl.getExtension("WEBGL_debug_renderer_info");
            intervals.sort((a, b) => a - b);
            resolve({
              fps: Math.round((intervals.length * 1000) / (now - start)),
              p95FrameMs:
                Math.round(
                  intervals[Math.floor(intervals.length * 0.95)] * 100,
                ) / 100,
              userAgent: navigator.userAgent,
              gpu: extension
                ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
                : "unavailable",
              dpr: devicePixelRatio,
            });
          }
        };
        requestAnimationFrame(frame);
      }),
  );
  return { results, viewportResize: resized, performance };
}
