// 仅在测试上下文读取真实相机和岩石实例；生产场景不新增可变的调试接口。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const [width,height] of [[393,852],[430,932],[480,1040],[600,1000]]) {
    const context = await page.context().browser().newContext({viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    try {
      const target = await context.newPage();
      await target.route(/\/src\/scene\.ts(?:\?|$)/, async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace('const firstSubmit = performance.now();',
          'window.__foregroundReview = {camera, terrain, chest}; const firstSubmit = performance.now();');
        await route.fulfill({response,body});
      });
      await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]');
      const result = await target.evaluate(async () => {
        const THREE = await import('/node_modules/.vite/deps/three.js');
        const {terrain,chest}=window.__foregroundReview;
        const rocks=terrain.group.getObjectByName('terrain-rocks');
        const matrix=new THREE.Matrix4(), point=new THREE.Vector3();
        let nearest=-Infinity;
        for(let i=0;i<rocks.count;i++) {
          rocks.getMatrixAt(i,matrix);
          const vertices=rocks.geometry.attributes.position;
          for(let j=0;j<vertices.count;j++)
            nearest=Math.max(nearest,point.fromBufferAttribute(vertices,j).applyMatrix4(matrix).z);
        }
        const box=JSON.parse(document.querySelector('#scene').dataset.boxBounds);
        return {rocks:rocks.count,nearest,chestZ:chest.box.position.z,box,
          foregroundClear:nearest<=chest.box.position.z-.2+.0001,
          closeEnough:box.bottom>innerHeight*.86 && box.right-box.left>innerWidth*.62};
      });
      if (!result.rocks || !result.foregroundClear || !result.closeEnough)
        throw new Error(`${width}x${height}: ${JSON.stringify(result)}`);
      await target.screenshot({path:`output/playwright/foreground-${width}x${height}.png`});
      results.push({width,height,...result});
    } finally {await context.close();}
  }
  return results;
}
