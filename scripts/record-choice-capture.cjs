// 复用浏览器 CDP 与本机既有 FFmpeg；帧数据只交给本地转换脚本，不安装录屏依赖。
async (page) => {
  const browser=page.context().browser(),origin=new URL(page.url()).origin,results=[];
  for(const [name,width,height] of [['desktop',1366,768],['phone',390,844],['short-phone',320,480]]) {
    const context=await browser.newContext({viewport:{width,height}}),target=await context.newPage();
    const frames=[],acknowledgements=[];
    try {
      await target.goto(origin);await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      const cdp=await context.newCDPSession(target);
      cdp.on('Page.screencastFrame',event=>{
        frames.push({data:event.data,time:event.metadata.timestamp});
        acknowledgements.push(cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}));
      });
      // 高刷新率显示器每三帧采样一次，保留动作连续性并限制本地帧数据传输体积。
      await cdp.send('Page.startScreencast',{format:'jpeg',quality:92,maxWidth:width,maxHeight:height,everyNthFrame:3});
      await target.waitForTimeout(200);
      // 两次宝盒激活间留出完整播放窗口，记录归位以及第二次仍可触发的实际画面。
      await target.locator('#box-button').click();await target.waitForTimeout(2100);
      await target.locator('#box-button').click();await target.waitForTimeout(2100);
      await target.locator('[data-entrance=world]').hover();await target.waitForTimeout(1900);
      await cdp.send('Page.stopScreencast');await Promise.all(acknowledgements);
      if(frames.length<30) throw new Error(`${name}: 录屏帧数不足`);
      results.push({name,width,height,frames});
    } finally {await context.close();}
  }
  return results;
}
