// 在新增的异步着色器准备阶段取消，验证加载失败和离页均不会恢复迟到场景。
async (page) => {
  const browser=page.context().browser(),origin=new URL(page.url()).origin,results=[];
  for(const event of ['moon-boot-failed','pagehide']){
    const context=await browser.newContext();
    try{
      const target=await context.newPage(),errors=[];
      target.on('pageerror',error=>errors.push(error.message));
      await target.route(/\/src\/scene\/gpu-initialization\.ts(?:\?|$)/,async route=>{
        const response=await route.fetch(),source=await response.text();
        // 保留真实 compileAsync 的资源创建，再在第一次返回 Promise 后立即触发取消。
        const marker=/const compilation\s*=\s*renderer\.compileAsync\(object,\s*camera,\s*scene\);/;
        // Vite 输出会调整空格，定位语义调用而不绑定源文件的排版。
        if(!marker.test(source)) throw new Error('未找到实际编译入口');
        await route.fulfill({response,body:source.replace(marker,`
          const compilation=renderer.compileAsync(object,camera,scene);
          if(!window.__choiceCompileCancelled){
            window.__choiceCompileCancelled=true;
            window.__choiceCompileContext=renderer.getContext();
            dispatchEvent(new Event('${event}'));
          }
          `)});
      });
      await target.route('**/__choice-compile-review',route=>route.fulfill({contentType:'text/html',
        body:'<div id="scene" style="width:800px;height:600px"></div><button></button>'}));
      await target.goto(`${origin}/__choice-compile-review`);
      const data=await target.evaluate(async()=>{
        const {createScene}=await import('/src/scene.ts');
        let rejected=false;
        try{await createScene(document.querySelector('#scene'),document.querySelector('button'),()=>{});}
        catch(error){if(error.name!=='AbortError')throw error;rejected=true;}
        await new Promise(resolve=>setTimeout(resolve,100));
        return {rejected,cancelled:window.__choiceCompileCancelled,canvases:document.querySelectorAll('#scene canvas').length,
          contextLost:window.__choiceCompileContext?.isContextLost()};
      });
      if(!data.rejected || !data.cancelled || data.canvases!==0 || !data.contextLost || errors.length)
        throw new Error(`${event}: ${JSON.stringify({data,errors})}`);
      results.push({event,...data,errors});
    }finally{await context.close();}
  }
  return results;
}
