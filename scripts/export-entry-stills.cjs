// 在开发服务器页面运行：直接导出共享渲染配置的透明首帧，所有临时 WebGL 资源均在导出后释放。
async (page) => {
  const origin=new URL(page.url()).origin,context=await page.context().browser().newContext();
  try {
    const target=await context.newPage();
    await target.route('**/__entry-still-export',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>入口首帧导出</title>'}));
    await target.goto(`${origin}/__entry-still-export`);
    const frames=await target.evaluate(async()=>{
      const {createEntryArtwork}=await import('/src/entry-artwork.ts');
      const {Initialization}=await import('/src/scene/initialization.ts');
      const {createEntryRenderer,createEntryScene,resizeEntryRenderer}=await import('/src/entry-rendering.ts');
      const canvas=document.createElement('canvas');
      const renderer=createEntryRenderer(canvas);
      const frames=[];
      try {
        for(const kind of ['crown','monkey']) {
          const init=new Initialization();
          const model=await createEntryArtwork(kind,init);
          try {
            const {scene,camera}=createEntryScene(model);
            for(const size of [30,36,44]) for(const ratio of [1,2]) for(const eyes of kind==='crown'?[0]:[0,1]) {
              resizeEntryRenderer(renderer,size,ratio);
              // 红眼后备只改变眼色，保持相同姿态与无红丝状态，退化环境下仍能平滑显示聚焦反馈。
              model.update(0,0,eyes,0);
              renderer.render(scene,camera);
              const name=`entry-${kind}${eyes?'-active':''}-${size}${ratio===2?'@2x':''}.png`;
              frames.push({name,url:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height});
            }
          } finally {init.dispose();}
        }
      } finally {renderer.dispose();renderer.forceContextLoss();}
      return frames;
    });
    for(const frame of frames) {
      const pending=target.waitForEvent('download');
      await target.evaluate(({name,url})=>{
        const link=document.createElement('a');link.href=url;link.download=name;link.textContent=name;
        document.body.replaceChildren(link);
      },frame);
      // 每张图片通过真实点击下载，避免连续脚本点击触发浏览器的自动多文件下载限制。
      await target.getByRole('link',{name:frame.name,exact:true}).click();
      const download=await pending;
      await download.saveAs(`public/assets/${frame.name}`);
    }
    return frames.map(({name,width,height,url})=>({name,width,height,bytes:Math.floor((url.length-url.indexOf(',')-1)*.75)}));
  } finally {await context.close();}
}
