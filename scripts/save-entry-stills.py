"""先在开发服务会话运行 export-entry-stills.cjs，将 CLI 输出文件作为参数传入本脚本。"""
import base64
import json
import sys
from pathlib import Path

# CLI 的 Result 后是单行 JSON；只接受固定 PNG 文件名，禁止返回值写到素材目录之外。
raw = Path(sys.argv[1]).read_bytes()
capture = raw.decode("utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")
frames, _ = json.JSONDecoder().raw_decode(capture.split("### Result", 1)[1].lstrip())
assets = Path(__file__).resolve().parent.parent / "public" / "assets"
for frame in frames:
    name = frame["name"]
    if Path(name).name != name or not name.startswith("entry-") or not name.endswith(".png"):
        raise ValueError(f"非法首帧文件名：{name}")
    (assets / name).write_bytes(base64.b64decode(frame["url"].split(",", 1)[1]))
print(f"saved {len(frames)} entry stills")
