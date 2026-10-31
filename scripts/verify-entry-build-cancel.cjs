// 通过 playwright-cli run-code --filename 执行，使用 Vite 开发地址；在真实构建检查点取消并核对 GPU 与模型资源。
async (page) => {
  const origin=new URL(page.url()).origin,results=[];
  for(const [action,phase,checkpoint] of [["dispose","entry-model",4],["pagehide","entry-model",10],
    ["moon-boot-failed","entry-gpu",2],["journey","entry-gpu",4]]) {
    const context=await page.context().browser().newContext({viewport:{width:800,height:600}});
    try {
      const target=await context.newPage(),errors=[];
      target.on("pageerror",error=>errors.push(error.message));
      await target.route("**/__entry-cancel",route=>route.fulfill({contentType:"text/html",body:
        '<a data-entrance="world"><span class="entry-icon" style="display:block;width:44px"></span><span class="entry-copy">world</span></a>'+
        '<a data-entrance="blog"><span class="entry-icon" style="display:block;width:44px"></span><span class="entry-copy">blog</span></a>'}));
      await target.goto(origin+"/__entry-cancel");
      const result=await target.evaluate(async ({action,phase,checkpoint})=>{
        const {Initialization}=await import("/src/scene/initialization.ts");
        const {installEntryIcons}=await import("/src/entry-icons.ts");
        const originalTrack=Initialization.prototype.track,originalCheckpoint=Initialization.prototype.checkpoint;
        const resources=new Map(),contexts=new Set();
        const getContext=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,...args) {
          const context=getContext.call(this,type,...args);if(/webgl/.test(type)&&context) contexts.add(context);return context;
        };
        Initialization.prototype.track=function(resource) {
          if(!resources.has(resource)) {
            resources.set(resource,0);resource.addEventListener("dispose",()=>resources.set(resource,resources.get(resource)+1));
          }
          return originalTrack.call(this,resource);
        };
        let checks=0,cancelled=false,dispose;
        Initialization.prototype.checkpoint=function(force) {
          if(this.phase===phase && ++checks===checkpoint) {
            cancelled=true;
            // 让取消落在已排队的续体之前，模拟真实点击、离页及启动失败。
            queueMicrotask(()=>{
              if(action==="dispose") dispose();
              else if(action==="journey") dispose.cancelPending();
              else window.dispatchEvent(action==="pagehide"?new PageTransitionEvent(action):new Event(action));
            });
            return originalCheckpoint.call(this,true);
          }
          return originalCheckpoint.call(this,force);
        };
        dispose=installEntryIcons([...document.querySelectorAll("a")]);
        await new Promise(resolve=>setTimeout(resolve,1500));
        const canvases=document.querySelectorAll("canvas").length;
        dispose();dispose();
        const counts=[...resources.values()],lost=[...contexts].map(gl=>gl.isContextLost());
        if(!cancelled||canvases||!counts.length||counts.some(count=>count!==1)||lost.some(value=>!value))
          throw new Error(JSON.stringify({action,phase,checkpoint,cancelled,canvases,counts,lost}));
        return {action,phase,checkpoint,cancelled,canvases,resources:counts.length,contextsLost:lost};
      },{action,phase,checkpoint});
      if(errors.length) throw new Error(JSON.stringify(errors));
      results.push(result);
    } finally {await context.close();}
  }
  return results;
}
