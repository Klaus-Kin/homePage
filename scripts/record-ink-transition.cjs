// 入口：node scripts/record-ink-transition.cjs [预览地址]。复用 npx Playwright CLI 和系统 FFmpeg，无需 NODE_PATH 或项目 Playwright 依赖。
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { existsSync } = require("node:fs");

// Windows 的 npx.cmd 不能直接通过无 shell 的 spawn 执行，定位其配套 JS 入口以保持参数原样传递。
function npxCommand() {
  if (process.platform !== "win32") return { command: "npx", prefix: [] };
  const found = spawnSync("where.exe", ["npx.cmd"], { encoding: "utf8", windowsHide: true });
  const directories = [path.dirname(process.execPath), ...(found.stdout || "").trim().split(/\r?\n/).filter(Boolean).map(file => path.dirname(file))];
  for (const directory of directories) {
    const script = path.join(directory, "node_modules/npm/bin/npx-cli.js");
    if (existsSync(script)) return { command: process.execPath, prefix: [script] };
  }
  throw new Error("无法定位 npx；请确认 Node.js/npm 已安装且 npx 位于 PATH 中。");
}

async function main() {
  const origin = new URL(process.argv[2] || "http://127.0.0.1:4175/");
  if (!["http:", "https:"].includes(origin.protocol)) throw new Error("录制地址必须使用 HTTP 或 HTTPS。");
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });
  if (ffmpeg.error || ffmpeg.status !== 0) throw new Error(`FFmpeg 不可用，请先将 ffmpeg 放入 PATH：${ffmpeg.error?.message || ffmpeg.stderr}`);
  const npx = npxCommand(), session = `ink-record-${process.pid}`, directory = path.resolve("output/playwright/ink-video");
  await fs.mkdir(directory, { recursive: true });
  const cli = (...args) => {
    const result = spawnSync(npx.command, [...npx.prefix, "--yes", "--package", "@playwright/cli", "playwright-cli", "--raw", `-s=${session}`, ...args], {
      encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 120000,
    });
    if (result.error || result.status !== 0) throw new Error(`Playwright CLI ${args[0]} 失败：${result.error?.message || result.stderr || result.stdout}`);
    return result.stdout.trim();
  };
  let opened = false;
  try {
    cli("open", origin.href); opened = true;
    // CLI 自己提供 Playwright 运行时；这里只解析帧数据，宿主脚本只使用 Node 内置模块。
    const recordings = JSON.parse(cli("run-code", "--filename", path.join(__dirname, "record-ink-capture.cjs")));
    const results = [];
    for (const recording of recordings) {
      const { name, frames, ...metrics } = recording;
      const files = frames.map((frame, i) => path.join(directory, `${name}-frame-${String(i).padStart(5, "0")}.jpg`));
      await Promise.all(frames.map((frame, i) => fs.writeFile(files[i], Buffer.from(frame.data, "base64"))));
      const concat = path.join(directory, `${name}-frames.txt`), video = path.join(directory, `${name}.mp4`);
      const body = frames.map((frame, i) => `file '${path.basename(files[i])}'\nduration ${Math.max(.001, (frames[i + 1]?.time ?? frame.time + .04) - frame.time)}\n`).join("");
      await fs.writeFile(concat, body);
      const encoded = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concat, "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", video], { encoding: "utf8", windowsHide: true });
      if (encoded.error || encoded.status !== 0) throw new Error(`FFmpeg 编码失败：${encoded.error?.message || encoded.stderr}`);
      results.push({ name, video, frames: frames.length, ...metrics });
      // 只清理本次成功编码的临时帧，失败时保留帧文件用于诊断。
      await Promise.all(files.map(file => fs.unlink(file))); await fs.unlink(concat);
    }
    await fs.writeFile(path.join(directory, "performance.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    // 关闭本入口创建的独立会话，清理失败不覆盖原始录制错误。
    if (opened) { try { cli("close"); } catch (error) { console.error(`录制会话清理失败：${error.message}`); } }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
