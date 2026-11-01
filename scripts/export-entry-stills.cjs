// 在开发服务器页面运行：直接导出共享渲染配置的透明首帧，所有临时 WebGL 资源均在导出后释放。
// 将 CLI 输出重定向到 output/playwright/entry-stills.txt，再运行 python scripts/save-entry-stills.py output/playwright/entry-stills.txt。
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
            for(const size of [30,36,44]) for(const ratio of [1,2]) for(const eyes of kind==='crown'?[0]:[0,1]) for(const color of [false,true]) {
              resizeEntryRenderer(renderer,size,ratio);
              // 红眼后备只改变眼色，保持相同姿态与无红丝状态，退化环境下仍能平滑显示聚焦反馈。
              model.update(0,0,eyes,0);
              // 原色与月夜首帧由同一相机和网格导出；只改变双纹理混合进度。
              model.setColorReveal?.(color?1:0);
              renderer.render(scene,camera);
              const name=`entry-${kind}${eyes?'-active':''}${color?'-color':''}-${size}${ratio===2?'@2x':''}.png`;
              frames.push({name,url:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height});
            }
          } finally {init.dispose();}
        }
      } finally {renderer.dispose();renderer.forceContextLoss();}
      return frames;
    });
    // 返回像素由本地保存器写入，避免连续下载触发浏览器的多文件下载限额。
    return frames;
  } finally {await context.close();}
}
