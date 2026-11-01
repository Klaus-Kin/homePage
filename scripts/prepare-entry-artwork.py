"""从用户提供的透明原稿拆分入口图标、冠羽和三种鼠标，统一月夜色调并保持透明边缘。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"


def moonlight(image):
    # 在同一素材生成阶段收敛橙金饱和度，并用偏蓝的暗部与银金高光呼应山谷月光。
    # 只处理 RGB；保留原 alpha，使实时网格、静态后备和原生鼠标边缘完全一致。
    alpha = image.getchannel("A")
    subdued = ImageEnhance.Color(image.convert("RGB")).enhance(0.42)
    channels = [channel.point(lambda value, gain=gain, lift=lift: round(value * 0.73 * gain + lift))
                for channel, gain, lift in zip(subdued.split(), (1.02, 1.0, 0.98), (4, 9, 18))]
    return Image.merge("RGBA", (*channels, alpha))


def trim(image):
    # 忽略几乎不可见的游离像素，透明留白不会挤占小尺寸图标的主体。
    bounds = image.getchannel("A").point(lambda value: 255 if value > 24 else 0).getbbox()
    return image.crop(bounds)


def save(image, name, limit=512):
    image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    image.save(ASSETS / name, optimize=True)


def save_color_pair(image, name, limit=512):
    # 两版先共享原稿的裁切与遮罩，再以相同算法缩放；透明通道逐像素相同。
    save(moonlight(image), name, limit)
    save(image.copy(), name.replace(".png", "-color.png"), limit)


icons = Image.open(ROOT / "金羽王冠与猿王头像.png").convert("RGBA")
crown = icons.crop((0, 0, 950, icons.height))
monkey = trim(icons.crop((950, 0, icons.width, icons.height)))
save_color_pair(monkey, "entry-monkey-artwork.png")

# 金色冠座覆盖羽根，三个互补透明遮罩重合后精确恢复完整原稿。
base_mask = Image.new("L", crown.size)
ImageDraw.Draw(base_mask).polygon(
    [(367, 495), (371, 452), (404, 413), (458, 413), (479, 470),
     (498, 418), (539, 414), (575, 452), (578, 494), (625, 550),
     (654, 596), (648, 758), (308, 758), (308, 567), (341, 537)], fill=255)
bounds = crown.getchannel("A").point(lambda value: 255 if value > 24 else 0).getbbox()
for name, region in [("base", None), ("left", (0, 0, 480, crown.height)),
                     ("right", (480, 0, crown.width, crown.height))]:
    mask = base_mask.copy() if region is None else ImageChops.invert(base_mask)
    if region is not None:
        half = Image.new("L", crown.size)
        ImageDraw.Draw(half).rectangle(region, fill=255)
        mask = ImageChops.multiply(mask, half)
    layer = crown.copy()
    layer.putalpha(ImageChops.multiply(crown.getchannel("A"), mask))
    save_color_pair(layer.crop(bounds), f"entry-crown-{name}.png")

cursor = Image.open(ROOT / "金红云纹金箍棒与猴手饰件.png").convert("RGBA")
for name, left, right in [("staff", 0, 700), ("point", 700, 1350), ("grab", 1350, cursor.width)]:
    item = trim(cursor.crop((left, 0, right, cursor.height)))
    # 同一 72px 方形画幅保留 3px 外边距；棒头、指尖和抓取中心分别对齐各自热点。
    versions = [("", moonlight(item))] + ([("-color", item.copy())] if name != "staff" else [])
    for suffix, version in versions:
        version.thumbnail((132, 132), Image.Resampling.LANCZOS)
        tile = Image.new("RGBA", (144, 144))
        tile.alpha_composite(version, (6, 6))
        tile.save(ASSETS / f"cursor-{name}{suffix}.png", optimize=True)
        if not suffix:
            tile.resize((72, 72), Image.Resampling.LANCZOS).save(ASSETS / f"cursor-{name}-native.png", optimize=True)
