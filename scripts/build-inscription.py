"""制作题词专用矢量资源。仅离线制作用 fontTools / Shapely，网站和 Vite 构建均不依赖它们。

运行示例：python scripts/build-inscription.py --tooling output/calligraphy/tooling
底稿下载到忽略目录 output；交付资源只包含此句轮廓、分笔和授权，不包含字体文件。
"""
import argparse
import hashlib
import math
from pathlib import Path
import sys
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--tooling", type=Path)
args = parser.parse_args()
if args.tooling:
    sys.path.insert(0, str(args.tooling.resolve()))

from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from shapely.geometry import Polygon, LineString, MultiPoint
from shapely.ops import unary_union, voronoi_diagram

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "output/calligraphy"
CACHE.mkdir(parents=True, exist_ok=True)
SOURCE = "https://raw.githubusercontent.com/google/fonts/main/ofl/zhimangxing/"
for name in ("ZhiMangXing-Regular.ttf", "OFL.txt"):
    if not (CACHE / name).exists():
        urllib.request.urlretrieve(SOURCE + name, CACHE / name)

# 坐标依照原字形逐笔校订，原点在字框左上；连笔作为一条连续行笔轨迹，绝非外轮廓描边。
PENS = {
    "一": [[(9,47),(22,48),(43,41),(70,37),(81,40)]],
    "念": [
        [(46,6),(43,20),(30,30),(16,42),(9,54),(11,61),(27,49),(42,29)],
        [(40,24),(54,19),(62,20),(67,24)],
        [(42,38),(45,43),(51,40)],
        [(62,27),(53,33),(45,37),(52,38),(39,58),(35,60),(56,54)],
        [(22,73),(22,82)],
        [(23,79),(43,71),(47,74),(49,80),(52,75),(61,70)],
        [(69,69),(76,74),(70,78),(65,78)],
    ],
    "间": [
        [(33,12),(37,18),(27,23),(23,22)],
        [(15,35),(19,42),(17,63),(20,77)],
        [(55,15),(62,11),(69,10),(70,76),(65,73)],
        [(35,40),(36,64)],
        [(34,41),(45,36),(49,38),(50,60)],
        [(37,50),(47,49)],
        [(37,61),(46,60)],
    ],
    ",": [[(9,62),(10,71),(6,85),(5,91)]],
    "又": [
        [(26,26),(39,25),(55,16),(60,17),(50,36),(38,53),(20,71),(6,77)],
        [(26,37),(44,48),(59,60),(76,70),(85,72)],
    ],
    "是": [
        [(28,14),(30,23),(29,37)],
        [(31,14),(41,8),(44,8),(47,11),(46,35)],
        [(30,25),(42,23)],
        [(30,34),(45,32)],
        [(6,54),(17,54),(39,44),(61,39)],
        [(42,43),(44,51),(41,68)],
        [(43,51),(53,51),(58,53)],
        [(32,59),(24,70),(3,84)],
        [(29,69),(41,72),(64,80),(78,81),(89,79)],
    ],
    "另": [
        [(38,13),(36,21),(40,29)],
        [(39,14),(51,12),(53,13),(46,27)],
        [(40,29),(52,28)],
        [(16,58),(33,52),(55,43),(67,41),(72,42),(71,56),(64,71),(53,77),(46,74),(40,65)],
        [(55,43),(49,56),(39,71),(27,79)],
    ],
    "个": [
        [(45,8),(43,16),(32,29),(19,44),(7,50)],
        [(39,25),(57,26),(71,29),(81,33)],
        [(39,35),(42,41),(40,60),(40,80)],
    ],
    "世": [
        [(7,50),(20,52),(46,42),(67,36),(83,35)],
        [(31,26),(30,36),(26,34),(24,31)],
        [(39,20),(47,24),(55,19),(64,18),(65,23),(59,37),(43,57),(31,64),(40,69)],
        [(31,65),(47,64),(61,61),(71,63)],
    ],
    "界": [
        [(27,22),(28,30),(31,35),(30,40)],
        [(32,14),(49,9),(58,10),(59,13),(54,28),(43,35),(29,39)],
        [(33,23),(50,19)],
        [(45,17),(43,29),(42,34)],
        [(30,38),(45,31)],
        [(43,34),(28,50),(12,64),(12,68),(25,60),(39,54)],
        [(59,51),(65,52),(74,57),(76,62)],
        [(38,54),(40,55),(33,65),(26,71)],
        [(30,67),(42,64),(48,68),(49,74),(43,80),(34,84),(26,82),(25,77),(32,73)],
    ],
}

# 少量固定飞白沿笔势刻在墨面内部；不影响字形边缘，也不在动画期间生成随机噪点。
DRY = {
    "一": [[(25,47),(37,43),(50,41)], [(52,40),(63,39)]],
    "念": [[(15,53),(22,46)], [(39,74),(44,73)]],
    "间": [[(68,35),(69,55)]],
    "又": [[(25,61),(35,50)], [(62,63),(73,69)]],
    "是": [[(14,77),(23,70)], [(59,77),(72,80)]],
    "另": [[(29,53),(42,47)], [(62,65),(57,71)]],
    "个": [[(22,38),(30,30)], [(40,57),(40,72)]],
    "世": [[(26,49),(39,46)], [(48,65),(58,64)]],
    "界": [[(29,18),(38,15)], [(19,62),(28,56)]],
}


class OutlinePen(BasePen):
    """将字体的二次曲线细分成高精度几何，仅供离线分笔；浏览器不解析字体。"""
    def __init__(self, glyphs):
        super().__init__(glyphs)
        self.contours = []
        self.current = []

    def _moveTo(self, p):
        self.current = [p]

    def _lineTo(self, p):
        self.current.append(p)

    def _qCurveToOne(self, control, end):
        start = self._getCurrentPoint()
        for step in range(1, 13):
            t = step / 12
            self.current.append(tuple((1-t)**2*start[i] + 2*(1-t)*t*control[i] + t*t*end[i] for i in (0,1)))

    def _closePath(self):
        self.contours.append([(x/10, (850-y)/10) for x,y in self.current])

    def _endPath(self):
        self._closePath()


def outline(font, character):
    glyphs = font.getGlyphSet()
    pen = OutlinePen(glyphs)
    glyphs[font.getBestCmap()[ord(character)]].draw(pen)
    # 原字形的轮廓包含封闭空白，按奇偶填充合成，保留自然起收锋及内部孔洞。
    shape = Polygon()
    for contour in pen.contours:
        shape = shape.symmetric_difference(Polygon(contour).buffer(0))
    for dry in DRY.get(character, []):
        scratch = LineString(dry).buffer(0.17, cap_style=2)
        shape = shape.difference(scratch.intersection(shape.buffer(-0.9)))
    return shape.simplify(0.018, preserve_topology=True)


def path_for(shape):
    if shape.is_empty:
        return ""
    polygons = [shape] if shape.geom_type == "Polygon" else list(shape.geoms)
    parts = []
    for polygon in polygons:
        if polygon.geom_type != "Polygon":
            continue
        for ring in [polygon.exterior, *polygon.interiors]:
            points = list(ring.coords)[:-1]
            parts.append("M" + "L".join(f"{x:.2f},{y:.2f}" for x,y in points) + "Z")
    return "".join(parts)


def partition(shape, trajectories):
    # 每条轨迹以细密采样点划分最近笔画区域；相交处也只属于一笔，后写笔画不会被前一笔遮罩擦亮。
    samples = []
    for line in trajectories:
        count = math.ceil(line.length / 0.85)
        samples.extend(line.interpolate(i / count, normalized=True) for i in range(count + 1))
    cells = voronoi_diagram(MultiPoint(samples), envelope=shape.envelope.buffer(100))
    groups = [[] for _ in trajectories]
    for cell in cells.geoms:
        part = cell.intersection(shape)
        if part.is_empty:
            continue
        probe = cell.representative_point()
        # 单元归属由其包含的采样点决定，避免用远离笔画的外部单元中心误判端点。
        site = min(samples, key=lambda point: point.distance(probe))
        owner = min(range(len(trajectories)), key=lambda i: trajectories[i].distance(site))
        groups[owner].append(part)
    return [unary_union(group).simplify(0.00001, preserve_topology=True) for group in groups]


font = TTFont(CACHE / "ZhiMangXing-Regular.ttf")
bank = {}
for character, pens in PENS.items():
    shape = outline(font, character)
    lines = [LineString(points) for points in pens]
    pieces = partition(shape, lines)
    assert shape.symmetric_difference(unary_union(pieces)).area < 0.15, "分笔不能遗漏墨面"
    bank[character] = (shape, lines, pieces)

sentence = "一念间,又是另一个世界"
result = ['<!-- 志莽行书底稿的专句改作；来源、字体 SHA256 及 OFL 1.1 见 /assets/inscription.LICENSE.txt。 -->',
          '<div id="inscription" aria-hidden="true" data-visible="false"><div class="inscription-composition">']
for line_index, text in enumerate((sentence[:4], sentence[4:])):
    result.append('<span class="inscription-line">')
    for index, character in enumerate(text):
        uid = f"ink-{line_index}-{index}"
        shape, lines, pieces = bank[character]
        comma = ' class="inscription-comma"' if character == "," else ""
        result.append(f'<svg{comma} viewBox="0 0 {22 if character == "," else 100} 100" data-character="{character}" focusable="false"><defs>')
        result.append(f'<path id="{uid}-full" d="{path_for(shape)}"/>')
        for i, (trajectory, piece) in enumerate(zip(lines, pieces)):
            if piece.is_empty:
                raise ValueError(f"{character} 的第 {i+1} 笔没有墨面")
            # 遮罩只覆盖自己独立的填充轮廓；扩展首尾后保证完整态不裁掉起收锋。
            polygons = [piece] if piece.geom_type == "Polygon" else list(piece.geoms)
            vertices = [p for polygon in polygons if polygon.geom_type == "Polygon" for p in polygon.exterior.coords]
            from shapely.geometry import Point
            radius = max(trajectory.distance(Point(p)) for p in vertices) + 0.8
            # 连笔形成回环时，最远点可能在墨面内部；校验整个填充片，防止最后一帧换完整墨面时突然补墨。
            while not trajectory.buffer(radius).covers(piece):
                radius += 0.25
            points = list(trajectory.coords)
            def extend(a,b):
                distance = math.dist(a,b)
                return (a[0] + (a[0]-b[0])*radius/distance, a[1] + (a[1]-b[1])*radius/distance)
            points = [extend(points[0],points[1]), *points, extend(points[-1],points[-2])]
            path = "M" + "L".join(f"{x:.2f},{y:.2f}" for x,y in points)
            result.append(f'<path id="{uid}-outline-{i}" d="{path_for(piece)}"/>')
            result.append(f'<mask id="{uid}-mask-{i}" maskUnits="userSpaceOnUse" x="-30" y="-30" width="160" height="160" style="mask-type:luminance"><path data-pen="{i}" data-length="{LineString(points).length:.3f}" d="{path}" pathLength="1" fill="none" stroke="white" stroke-width="{radius*2:.3f}" stroke-linecap="butt" stroke-linejoin="round" stroke-dasharray="1 1" stroke-dashoffset="1"/></mask>')
        result.append('</defs><g data-writing fill="#241b16" fill-rule="evenodd">')
        for i in range(len(pieces)):
            result.append(f'<use href="#{uid}-outline-{i}" mask="url(#{uid}-mask-{i})"/>')
        result.append(f'</g><use data-complete href="#{uid}-full" fill="#241b16" fill-rule="evenodd" opacity="0"/></svg>')
    result.append('</span>')
result.append('</div></div>')
asset = ROOT / "src/assets/inscription.svg"
asset.parent.mkdir(exist_ok=True)
asset.write_text("\n".join(result) + "\n", encoding="utf-8")
license_text = f"""题词：一念间,又是另一个世界
底稿：Zhi Mang Xing / 志莽行书，官方归类为行书。
来源：{SOURCE}ZhiMangXing-Regular.ttf
说明：https://github.com/google/fonts/blob/main/ofl/zhimangxing/DESCRIPTION.en_us.html
原字体 SHA256：{hashlib.sha256((CACHE / 'ZhiMangXing-Regular.ttf').read_bytes()).hexdigest()}
获取日期：2026-10-29。
改作：本项目的专句填充轮廓、局部分笔、书写轨迹与固定飞白，非官方笔顺数据。
生成入口：scripts/build-inscription.py。交付字形按下附 SIL OFL 1.1 授权保留。

"""
(ROOT / "public/assets/inscription.LICENSE.txt").write_text(license_text + (CACHE / "OFL.txt").read_text(encoding="utf-8"), encoding="utf-8")
print(f"专句资源：{asset.stat().st_size} bytes，{sum(len(bank[c][1]) for c in sentence)} 笔")
