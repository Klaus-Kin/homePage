// 用运行时同一模型和相机定格正面、转头、回正；放大图保留真实深度遮挡，便于检查远侧眼耳。
async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:540,height:540},deviceScaleFactor:1});
  try {
    const target=await context.newPage(),origin=new URL(page.url()).origin;
    await target.route('**/__monkey-turn-preview',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#151923}canvas{display:block}</style><canvas></canvas>'}));
    await target.goto(`${origin}/__monkey-turn-preview`);
    await target.evaluate(async()=>{
      const {createMonkey,disposeModel}=await import('/src/entry-models.ts');
      const {createEntryRenderer,createEntryScene,resizeEntryRenderer}=await import('/src/entry-rendering.ts');
      const model=createMonkey(),renderer=createEntryRenderer(document.querySelector('canvas'));
      resizeEntryRenderer(renderer,320,1);
      const {scene,camera}=createEntryScene(model);
      window.__turnPreview={model,renderer,scene,camera,disposeModel};
    });
    const results=[];
    for(const [name,time,amount,eyes,silk] of [['rest',0,0,0,0],['front-active',0,1,1,1],['right',900,1,1,1],['returned',1800,1,1,1]]) {
      const result=await target.evaluate(({time,amount,eyes,silk})=>{
        const {model,renderer,scene,camera}=window.__turnPreview;
        model.update(time,amount,eyes,silk);renderer.render(scene,camera);
        return {yawDegrees:model.root.rotation.y*180/Math.PI};
      },{time,amount,eyes,silk});
      await target.locator('canvas').screenshot({path:`output/playwright/monkey-turn-${name}.png`});
      results.push({name,...result});
    }
    // 同步绘制一周期的真实模型帧图集，供本地生成可查看的动图；不录入场景或改变产品交互。
    await target.evaluate(()=>{
      const {model,renderer,scene,camera}=window.__turnPreview;
      renderer.setSize(256,256,false);
      const atlas=document.createElement('canvas');atlas.id='turn-atlas';atlas.width=atlas.height=1536;
      const context=atlas.getContext('2d');context.fillStyle='#151923';context.fillRect(0,0,1536,1536);
      for(let frame=0;frame<36;frame++) {
        model.update(frame*50,1,1,1);renderer.render(scene,camera);
        context.drawImage(renderer.domElement,(frame%6)*256,Math.floor(frame/6)*256);
      }
      document.body.append(atlas);
    });
    await target.locator('#turn-atlas').screenshot({path:'output/playwright/monkey-turn-atlas.png'});
    await target.evaluate(()=>{
      const {model,renderer,disposeModel}=window.__turnPreview;
      disposeModel(model.root);renderer.dispose();renderer.forceContextLoss();delete window.__turnPreview;
    });
    return results;
  } finally {await context.close();}
}
