// 入口：node scripts/record-loading-return.cjs [生产预览地址] [desktop|phone|short]。
// 复用 Playwright CLI 与系统 FFmpeg，录制、进度证据和截图统一写入忽略目录。
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { existsSync } = require("node:fs");

function npxCommand() {
  if (process.platform !== "win32") return { command: "npx", prefix: [] };
  // 直接执行 npm 的 JS 入口，避免 Windows shell 重新解释路径和参数。
  const found = spawnSync("where.exe", ["npx.cmd"], { encoding: "utf8", windowsHide: true });
  const directories = [path.dirname(process.execPath), ...(found.stdout || "").trim().split(/\r?\n/).filter(Boolean).map(file => path.dirname(file))];
  for (const directory of directories) {
    const script = path.join(directory, "node_modules/npm/bin/npx-cli.js");
    if (existsSync(script)) return { command: process.execPath, prefix: [script] };
  }
  throw new Error("无法定位 npx，请确认 Node.js/npm 已安装。");
}

async function main() {
  const address = new URL(process.argv[2] || "http://127.0.0.1:4175/"), selection = process.argv[3];
  if (!["http:", "https:"].includes(address.protocol)) throw new Error("预览地址必须使用 HTTP 或 HTTPS。");
  if (selection && !["desktop", "phone", "short"].includes(selection)) throw new Error("视口必须是 desktop、phone 或 short。");
  const directory = path.resolve("output/playwright/hoop-return-video");
  await fs.mkdir(directory, { recursive: true });
  const npx = npxCommand(), session = `hoop-record-${process.pid}`;
  const cli = (...args) => {
    const result = spawnSync(npx.command, [...npx.prefix, "--no-install", "@playwright/cli", "--raw", `-s=${session}`, ...args], {
      encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 240000,
    });
    if (result.error || result.status !== 0) throw new Error(`Playwright CLI ${args[0]} 失败：${result.error?.message || result.stderr || result.stdout}`);
    return result.stdout.trim();
  };
  const results = [];
  let opened = false;
  try {
    cli("open", address.href); opened = true;
    for (const viewport of selection ? [selection] : ["desktop", "phone", "short"]) {
      address.searchParams.set("view", viewport);
      cli("goto", address.href);
      const recordings = JSON.parse(cli("run-code", "--filename", path.join(__dirname, "verify-navigation-lifecycle.cjs")));
      for (const recording of recordings) {
        const { name, frames, ...metrics } = recording;
        const files = frames.map((frame, i) => path.join(directory, `${name}-frame-${String(i).padStart(5, "0")}.jpg`));
        await Promise.all(frames.map((frame, i) => fs.writeFile(files[i], Buffer.from(frame.data, "base64"))));
        const concat = path.join(directory, `${name}-frames.txt`), video = path.join(directory, `${name}.mp4`);
        // 使用实际帧时间，保留文档切换时的停顿，不能用固定帧率掩盖间隔。
        await fs.writeFile(concat, frames.map((frame, i) => `file '${path.basename(files[i])}'\nduration ${Math.max(.001, (frames[i + 1]?.time ?? frame.time + .04) - frame.time)}\n`).join(""));
        const encoded = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concat,
          "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", video], { encoding: "utf8", windowsHide: true });
        if (encoded.error || encoded.status !== 0) throw new Error(`FFmpeg 编码 ${name} 失败：${encoded.error?.message || encoded.stderr}`);
        results.push({ name, video, frameCount: frames.length, ...metrics });
        // 仅删除本次已成功编码的中间帧，失败时保留现场。
        await Promise.all(files.map(file => fs.unlink(file))); await fs.unlink(concat);
      }
      await fs.writeFile(path.join(directory, `${viewport}-metrics.json`), JSON.stringify(results.filter(result => result.name.startsWith(viewport)), null, 2));
      console.log(JSON.stringify(results.filter(result => result.name.startsWith(viewport)).map(({ samples, ...result }) => result), null, 2));
    }
  } finally {
    if (opened) { try { cli("close"); } catch (error) { console.error(`录制会话清理失败：${error.message}`); } }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
