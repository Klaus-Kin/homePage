// 真实 GPU 像素验收：花株风摆、同步投影、减少动态、画质缓存及开盖；测试接口只在路由内注入。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin = new URL(page.url()).origin, results = [];
  await page.route(/\/src\/scene\.ts(?:\?|$)/, async route => {
    const response = await route.fetch(), source = await response.text();
    const body = source.replace('const firstSubmit = performance.now();',
      'window.__meadowReview={terrain,renderer,camera,scene,chest,dispose}; const firstSubmit = performance.now();');
    if (body === source) throw new Error('草甸场景注入失败');
    await route.fulfill({response,body});
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(origin);
  await page.waitForSelector('#app[data-state="idle"]');
  for (const [name,width,height] of [['desktop',1440,900],['mobile',393,852]]) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const {terrain,renderer,scene,camera}=window.__meadowReview;
      const plants=[]; terrain.group.traverse(o=>{ if(o.userData.meadowKind) plants.push(o); });
      const flower=plants.find(o=>o.userData.meadowKind==='flowers');
      const gl=renderer.getContext(), a=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4), b=new Uint8Array(a.length);
      const rootMatrices=flower.instanceMatrix.array.slice();
      const uniforms=new Map();
      for(const plant of plants) {
        const main={uniforms:{},vertexShader:'',fragmentShader:''}, depth={uniforms:{},vertexShader:'',fragmentShader:''};
        plant.material.onBeforeCompile(main,renderer); plant.customDepthMaterial.onBeforeCompile(depth,renderer);
        if(main.uniforms.uWindTime!==depth.uniforms.uWindTime || main.uniforms.uWindStrength!==depth.uniforms.uWindStrength)
          throw new Error(`风摆和投影未同步：${plant.name}`);
        main.uniforms.uWindStrength.value=0;
        uniforms.set(plant,main.uniforms);
      }
      const render=(time,pixels,reduced=false)=>{
        for(const [plant,u] of uniforms) {
          u.uWindTime.value=time;
          u.uWindStrength.value=plant===flower && !reduced?flower.userData.windStrength:0;
        }
        renderer.shadowMap.needsUpdate=true; renderer.render(scene,camera);
        gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      };
      const difference=()=>{let n=0;for(let i=0;i<a.length;i+=4)
        if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>5)n++;
        return n;};
      render(0,a); render(Math.PI/1.4,b);
      const animatedPixels=difference();
      // 隐藏花株的颜色及深度，仅保留其真实投影；两次结果之差必须仍有移动的阴影。
      flower.material.colorWrite=flower.material.depthWrite=false;
      render(0,a); render(Math.PI/1.4,b);
      const movingShadowPixels=difference();
      // 再关闭投影，花株所有贡献都消失，此时不同风相位应当逐像素相同。
      flower.castShadow=false; render(0,a); render(Math.PI/1.4,b);
      const isolatedBackgroundDifference=difference();
      flower.castShadow=true; flower.material.colorWrite=flower.material.depthWrite=true;
      render(0,a,true); render(5,b,true);
      const reducedPixelChanges=difference();
      const rootsUnchanged=rootMatrices.every((v,i)=>v===flower.instanceMatrix.array[i]);
      terrain.update(0,true); renderer.shadowMap.needsUpdate=true; renderer.render(scene,camera);
      return {animatedPixels,movingShadowPixels,isolatedBackgroundDifference,reducedPixelChanges,rootsUnchanged,
        flowers:flower.count,resources:renderer.info.memory};
    });
    if(result.animatedPixels<20 || result.movingShadowPixels<10 || result.isolatedBackgroundDifference || result.reducedPixelChanges || !result.rootsUnchanged)
      throw new Error(JSON.stringify({name,...result}));
    await page.screenshot({path:`output/playwright/lawn-night-${name}.png`});
    results.push({name,...result});
  }
  // 检查往返构图不重新洗牌；对矩阵和颜色计算指纹，避免只比较数量。
  const restoration = await page.evaluate(async()=>{
    const {terrain}=window.__meadowReview;
    const fingerprints=()=>{ const values=[]; terrain.group.traverse(mesh=>{
      if(!mesh.userData.meadowKind)return;
      let hash=2166136261; for(const buffer of [mesh.instanceMatrix.array,mesh.instanceColor.array])
        for(const byte of new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength))hash=Math.imul(hash^byte,16777619);
      values.push([mesh.name,mesh.count,hash]);
    });return JSON.stringify(values);};
    await terrain.setQuality(false);const desktop=fingerprints();
    await terrain.setQuality(true);const mobile=fingerprints();
    await terrain.setQuality(false);const restored=fingerprints();
    if(desktop!==restored || desktop===mobile)throw new Error('画质恢复改变了矩阵或颜色');
    return {sameMatricesAndColors:true};
  });
  await page.setViewportSize({width:1440,height:900});
  await page.waitForTimeout(300);
  await page.screenshot({path:'output/playwright/lawn-night-desktop-restored.png'});
  // 用现有真实交互触发开盖，并在实体上盖抬起时取图，验证草叶未挡住点击目标。
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#box-button').click();
  await page.waitForFunction(()=>+document.querySelector('#scene').dataset.lidAngle>12);
  await page.screenshot({path:'output/playwright/lawn-night-opening.png'});
  await page.waitForFunction(()=>+document.querySelector('#scene').dataset.lidAngle===0,{timeout:15000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForTimeout(200);
  const frozen=await page.locator('#scene').getAttribute('data-frames');
  await page.waitForTimeout(200);
  if(frozen!==await page.locator('#scene').getAttribute('data-frames'))throw new Error('减少动态没有停止渲染');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForTimeout(200);
  if(frozen===await page.locator('#scene').getAttribute('data-frames'))throw new Error('恢复动态失败');
  return {results,restoration,opening:true,reducedMotionStopsAndResumes:true};
}
