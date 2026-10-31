# 第三方素材与授权说明

本文件汇总仓库内已有的素材来源记录。项目 [MIT 许可证](LICENSE) 适用于原创代码与文档，不替代第三方影像、字体及衍生字形的各自授权。已有素材授权原文保持不变；复制、修改或再分发相关资源时，应一并保留其署名、授权与改作说明。

## 月面影像

- 使用文件：[public/assets/moon-lroc.jpg](public/assets/moon-lroc.jpg)。
- 仓库来源记录：[src/scene.ts](src/scene.ts) 的月面加载注释，署名为 NASA's Scientific Visualization Studio，LRO / LROC 月面颜色图。
- 原始素材及使用信息：<https://svs.gsfc.nasa.gov/4720/>。
- 现有仓库没有单独收录该影像的授权全文。本说明仅转录已有来源，不将影像重新授权为 MIT；再利用前应查阅来源页面的使用要求并保留相应署名。

## 志莽行题词与静态行书

- 来源字体：Zhi Mang Xing / 志莽行书；Copyright 2018 The Zhi Mang Xing Project Authors。
- 原字体来源：<https://raw.githubusercontent.com/google/fonts/main/ofl/zhimangxing/ZhiMangXing-Regular.ttf>。
- 项目说明：<https://github.com/google/fonts/blob/main/ofl/zhimangxing/DESCRIPTION.en_us.html>。
- 授权与来源记录：[public/assets/inscription.LICENSE.txt](public/assets/inscription.LICENSE.txt)，包含 **SIL Open Font License 1.1 全文**、获取日期及原字体 SHA256。
- 关联资源：[src/assets/inscription.svg](src/assets/inscription.svg)、[src/calligraphy-glyphs.ts](src/calligraphy-glyphs.ts)；制作入口为 [scripts/build-inscription.py](scripts/build-inscription.py)。

题词“一念间,又是另一个世界”的填充轮廓、局部分笔、书写轨迹和固定飞白属于项目改作，不是官方笔顺数据。静态行书与题词使用同源字形；请按现有授权记录保留 OFL 1.1，不将交付字形笼统归入 MIT。

## 全字库小篆字形

- 来源署名：數位發展部，CNS11643 中文標準交換碼全字庫網站。
- 原始资料：全字庫「說文解字」字型 `ebas927.ttf`。
- 下载来源：<https://www.cns11643.gov.tw/downloadList.jsp?ID=2&ID2=20>。
- 来源授权声明：<https://www.cns11643.gov.tw/pageView.jsp?ID=59>。
- 仓库记录：[public/assets/seal-glyphs.LICENSE.txt](public/assets/seal-glyphs.LICENSE.txt)，记载 **政府資料開放授權條款第 1 版（Open Government Data License）**、署名与改作情况；条款地址为 <https://data.gov.tw/license>。
- 关联资源：[src/scene/seal-glyphs.ts](src/scene/seal-glyphs.ts)、[src/title-glyphs.ts](src/title-glyphs.ts)，用于宝盒刻字与页面标题。

项目摘取实际使用字形并转换为归一化矢量轮廓；部分缺字由同源部件重组，简体文案采用对应传统字形。具体字例见现有授权记录。这些轮廓与改作仍需遵守来源条款及署名要求。

## 场景预览与依赖

[public/assets/scene-desktop.webp](public/assets/scene-desktop.webp) 及其他 `scene-*.webp` 为场景静态导出；使用这些图像时也应保留其中所含第三方素材的来源说明，不能把截图视为素材授权的替代。

npm 依赖的版本记录在 [package-lock.json](package-lock.json)，各依赖的授权见其分发包内的许可证。再分发包含依赖的构建产物时，应保留适用的第三方许可声明。

本文仅依据本地源码与授权文件整理，未在线核验外部页面当前内容，也不扩大任何来源授予的权利。
