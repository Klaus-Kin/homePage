// 入口：node scripts/record-choice-motion.cjs [预览地址]。复用现有 Playwright CLI 和 FFmpeg，无新增依赖。
const {spawnSync}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path');
const {existsSync}=require('node:fs');

async function main() {
  const origin=new URL(process.argv[2] || 'http://127.0.0.1:5175/');
  if (!['http:','https:'].includes(origin.protocol)) throw new Error('预览地址必须使用 HTTP 或 HTTPS');
  const version=spawnSync('ffmpeg',['-version'],{encoding:'utf8',windowsHide:true});
  if (version.error || version.status!==0) throw new Error(`FFmpeg 不可用：${version.error?.message || version.stderr}`);
  // Windows 直接使用 npm 的 JS 入口，参数保持结构化传递，不拼接 shell 命令。
  let command='npx',prefix=[];
  if (process.platform==='win32') {
    const found=spawnSync('where.exe',['npx.cmd'],{encoding:'utf8',windowsHide:true});
    const dirs=[path.dirname(process.execPath),...(found.stdout || '').trim().split(/\r?\n/).filter(Boolean).map(file=>path.dirname(file))];
    const script=dirs.map(dir=>path.join(dir,'node_modules/npm/bin/npx-cli.js')).find(file=>existsSync(file));
    if (!script) throw new Error('无法定位 npx，请检查已有 Node.js/npm 安装');
    command=process.execPath; prefix=[script];
  }
  const session=`choice-record-${process.pid}`,directory=path.resolve('output/playwright/choice-video');
  await fs.mkdir(directory,{recursive:true});
  const cli=(...args)=>{
    const r=spawnSync(command,[...prefix,'--no-install','@playwright/cli','--raw',`-s=${session}`,...args],
      {encoding:'utf8',windowsHide:true,maxBuffer:256*1024*1024,timeout:120000});
    if (r.error || r.status!==0) throw new Error(`Playwright ${args[0]} 失败：${r.error?.message || r.stderr || r.stdout}`);
    return r.stdout.trim();
  };
  let opened=false;
  try {
    cli('open',origin.href); opened=true;
    // 宿主标签页不参与录制，关闭它的动态，避免占用被测页面的 GPU 帧预算。
    cli('set-reduced-motion','reduce');
    const recordings=JSON.parse(cli('run-code','--filename',path.join(__dirname,'record-choice-capture.cjs'))),results=[];
    for (const {name,width,height,frames} of recordings) {
      const files=frames.map((_,i)=>path.join(directory,`${name}-${String(i).padStart(5,'0')}.jpg`));
      await Promise.all(frames.map((frame,i)=>fs.writeFile(files[i],Buffer.from(frame.data,'base64'))));
      const concat=path.join(directory,`${name}-frames.txt`),video=path.join(directory,`${name}.mp4`);
      await fs.writeFile(concat,frames.map((frame,i)=>`file '${path.basename(files[i])}'\nduration ${Math.max(.001,(frames[i+1]?.time ?? frame.time+.04)-frame.time)}\n`).join(''));
      const encoded=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',concat,'-fps_mode','vfr','-c:v','libx264','-pix_fmt','yuv420p',video],{encoding:'utf8',windowsHide:true});
      if (encoded.error || encoded.status!==0) throw new Error(`录屏编码失败：${encoded.error?.message || encoded.stderr}`);
      results.push({name,width,height,frames:frames.length,video});
      // 仅清理本次成功编码的临时帧；失败时保留原始帧以便诊断。
      await Promise.all(files.map(file=>fs.unlink(file))); await fs.unlink(concat);
    }
    await fs.writeFile(path.join(directory,'recordings.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(results,null,2));
  } finally {
    if (opened) {try {cli('close');} catch(error) {console.error(`录屏会话清理失败：${error.message}`);}}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
