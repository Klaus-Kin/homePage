"""压缩由 capture-scene.cjs 导出的新场景截图；原参考图不参与运行时素材生成。"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
# 先检查所有输入，避免捕获不完整时只更新一部分降级图。
names = ("desktop", "tablet", "mobile", "short")
for name in names:
    source = ROOT / "output" / "playwright" / f"scene-{name}.png"
    if not source.is_file():
        raise FileNotFoundError(f"请先执行 capture-scene.cjs，缺少截图：{source}")
for name in names:
    source = ROOT / "output" / "playwright" / f"scene-{name}.png"
    destination = ROOT / "public" / "assets" / f"scene-{name}.webp"
    with Image.open(source) as image:
        image.convert("RGB").save(destination, quality=91, method=6)
    print(f"{name}: {destination.stat().st_size} bytes")
