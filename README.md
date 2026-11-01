[中文](README.md) | [English](README.en.md)

# 程序猿的月光宝盒

基于 TypeScript、Three.js 和 Vite 的电影感个人主页：以月夜、山石、草地和月光宝盒构成实时 3D 场景，通过两个文字入口连接博客与另一个站点。

![月光宝盒场景背景预览](public/assets/scene-desktop.webp)

上图是仓库现有的**场景背景预览**，也是静态降级资源之一；不包含完整页面文案、入口和动态效果。本仓库未提供在线演示地址。

## 功能与交互

- 月夜场景包含月面纹理、山体、岩石、分层植被、云、星空与流星，以及月光与接触阴影。
- 点击宝盒触发选择提示，引导用户选择文字入口；宝盒本身不指定跳转地址。
- 两个文字入口分别使用独立目标地址；普通点击依次触发宝盒开盖、光幕、题词书写和落墨转场，画面呈黑后导航。
- 凤冠与猴脸入口图标使用 Three.js 绘制，配有交互动效和 PNG 降级图。
- 桌面、平板、手机和矮屏采用不同构图预设，构图与画质分别选择。
- 响应系统的 `prefers-reduced-motion` 偏好，暂停或简化相关动画；页面进入后台时暂停动态更新。
- 提供键盘入口、可访问文字，以及 WebGL 不可用、资源加载失败和禁用 JavaScript 时的静态背景与链接。禁用 JavaScript 时不播放交互转场。

## 技术栈与环境

依赖版本以 [package.json](package.json) 和 [package-lock.json](package-lock.json) 为准：Three.js `0.186.1`、TypeScript `7.0.2`、Vite `8.3.5`，使用 ES modules。

推荐 **Node.js 22.18+** 与 npm，使用锁文件安装依赖。测试通过 Node 内置测试运行器及 `--experimental-strip-types` 直接运行 TypeScript；旧版 Node 可能不支持该命令。常规开发、测试和构建无需 Python。

## 快速开始

从实际仓库页面下载并解压源码，或使用该页面提供的真实地址克隆仓库。进入项目目录后运行（目录名按实际下载结果调整）：

```sh
cd homePage
npm ci
npm run dev
```

在浏览器打开终端输出的本地地址，默认通常为 `http://127.0.0.1:5173`；端口占用时以终端输出为准。开发服务默认仅绑定本机地址。不要直接双击 `index.html`。

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm run dev` | 启动本地 Vite 开发服务 |
| `npm test` | 运行 `tests/*.test.ts` |
| `npm run build` | 先执行 TypeScript 检查，再生成 `dist/` |
| `npm run preview` | 本地预览已有的生产构建 |
| `git diff --check` | 检查差异中的空白问题 |

生产预览需先运行 `npm run build`，再运行 `npm run preview`，访问终端输出的地址。

## 自定义配置

主要配置集中在 [src/config.ts](src/config.ts)：

| 配置 | 用途 |
| --- | --- |
| `pageConfig.title`、`titleLines` | 浏览器运行时标题与页面两行标题 |
| `pageConfig.description` | 页面介绍文案 |
| `entranceLabel`、`worldLabel`、`loadingLabel` | 两个入口和加载欢迎语 |
| `blogUrl`、`worldUrl` | 两个入口各自的导航地址 |
| `pageConfig.transition` | 蓄光、扩散、题词等待与书写时长，以及减少动态模式的对应时长，单位为毫秒 |
| `sceneConfig.layout`、`layoutRules` | 相机位置、目标高度、视野、月亮位置和构图选择条件 |
| `sceneConfig.quality` | 桌面与手机的像素比上限、阴影尺寸、植被及其他场景对象数量 |

当前配置为 `blogUrl: "https://blog.jinsc.icu/"`、`worldUrl: "https://kk.jinsc.de5.net/"`。部署前核对两个目标是否适用于本次发布；使用其他站点时修改配置并重新构建。第二入口仅导航至配置地址，主页不执行服务器状态查询。

[index.html](index.html) 中的静态 `<title>`、SEO description 和部分固定无脚本文字需按需同步；它们并非全部从 `pageConfig` 自动生成。宝盒选择提示的时长另见 [src/choice-prompt.ts](src/choice-prompt.ts)，入口图标动画见 [src/entry-motion.ts](src/entry-motion.ts)。修改相机或画质后需重新检查各视口，避免遮挡入口或裁切模型。

## 字形与素材维护

部分文字使用预生成的 SVG 矢量字形，不是运行时下载的完整字体。只改字符串可能造成缺字、构建失败、标题退回普通文字，或题词与可访问文字不一致：

- 正文、加载语与入口的行书字形位于 [src/calligraphy-glyphs.ts](src/calligraphy-glyphs.ts)。修改 `src/config.ts` 中这些文案后，可用 `python scripts/build-inscription.py --copy-only` 同步生成。
- 两行标题与宝盒刻字的小篆轮廓位于 [src/title-glyphs.ts](src/title-glyphs.ts) 和 [src/scene/seal-glyphs.ts](src/scene/seal-glyphs.ts)。新增字需补齐同源轮廓和必要别名；上面的脚本不生成小篆。
- 题词使用 [src/assets/inscription.svg](src/assets/inscription.svg)，原文常量位于 [src/inscription-strokes.ts](src/inscription-strokes.ts)。调整题词需同时维护 [scripts/build-inscription.py](scripts/build-inscription.py) 的句子、字形及人工校订轨迹，并重新生成资源；不能只改原文常量。

以下均为**可选素材制作工具**，不属于日常启动或构建步骤：

| 工具 | 前提与产物 |
| --- | --- |
| `python scripts/build-inscription.py --copy-only` | Python、fontTools、Shapely；生成静态行书字形。首次运行会下载字体和 OFL 到忽略目录 `output/calligraphy/` |
| `python scripts/build-inscription.py` | 同上；另重建题词 SVG 与其授权记录。修改前检查脚本，不要无意覆盖人工调整 |
| `scripts/capture-scene.cjs` → `python scripts/build-assets.py` | 先用下节的 Playwright CLI 在开发页面捕获四种场景，再用 Python 与 Pillow 将 `output/playwright/scene-*.png` 转为 `public/assets/scene-*.webp` |
| `scripts/export-entry-stills.cjs` | 通过 Playwright CLI 在开发服务页面执行，导出共享 Three.js 模型的入口 PNG 资源 |

Python 工具依赖需在单独的素材制作环境中准备；仓库没有 Python 锁文件。更换素材时保留来源、改作说明和授权记录，详见 [第三方素材说明](THIRD_PARTY_NOTICES.md)。

## 项目结构

```text
index.html                 页面壳、加载守卫与无脚本入口
src/
  main.ts                  启动、交互、导航与生命周期协调
  config.ts                文案、地址、转场、相机与画质配置
  scene.ts                 Three.js 主场景协调
  scene/                   地形、植被、岩石、宝盒、天空、灯光与资源释放
  responsive.ts            相机适配、投影边界与取景
  transition.ts            旅程状态与光幕进度
  inscription*.ts          题词笔画、时序与可见时间
  ink-*.ts                 落墨几何、渲染、时序与全黑导航门禁
  entry-*.ts               3D 入口图标、动效与渲染
  static-html.ts           开发与构建阶段生成静态文案和链接
  *glyphs.ts / calligraphy.ts / title.ts
                           预生成字形与文字渲染
  style.css                排版、响应式样式与静态背景
  assets/                  构建时内联的题词 SVG
public/assets/             月面纹理、静态场景、图标降级图和素材授权
tests/                     Node 单元与回归测试
scripts/                   浏览器验收、录制、截图和可选素材工具
```

`dist/`、`output/`、`.playwright-cli/` 和 `node_modules/` 是忽略目录，不应提交生成产物。

## 部署指南

1. 核对两个导航地址，按本次发布需要修改，并检查静态元信息与字形。
2. 运行 `npm ci`、`npm test` 和 `npm run build`。
3. 将 **`dist/` 内的内容**发布到静态托管服务，保留目录结构；不需要 Node 服务处理页面请求。
4. 从实际发布地址检查资源加载、两个入口、手机构图与静态降级。

当前默认按**域名根路径**部署。代码、样式和 HTML 中存在 `/assets/` 等根绝对路径；部署到 `/homepage/` 之类的子目录时，**只修改 Vite `base` 不够**，还需统一检查并调整这些路径以及图标、静态背景和降级资源，再重新构建和验收。`npm run preview` 用于本地验收，不作为生产托管服务。

## 测试与验收

提交前运行：

```sh
npm test
npm run build
git diff --check
```

这些命令不替代实际浏览器验收。视觉改动需检查桌面（如 1920×1080）、手机（如 390×844）与矮屏（如 844×390），保留截图和尺寸；受影响时检查减少动态、WebGL 不可用、加载失败、上下文丢失与禁用 JavaScript 的路径。

大多数 `scripts/verify-*.cjs` 和捕获脚本是传给浏览器执行器的 `async (page) => { ... }`，并非独立的 Node 程序。另行准备 Playwright CLI 及其浏览器后，先启动本地服务，再从仓库根目录调用，例如：

```sh
playwright-cli open http://127.0.0.1:5173
playwright-cli run-code --filename scripts/verify-layout.cjs
playwright-cli run-code --filename scripts/verify-fallback.cjs
```

地址需与当前服务一致；脚本通常从当前页面读取 origin。运行前创建 `output/playwright/`，阅读脚本头部和内容：导入 `/src/` 或拦截源码的脚本（如 `verify-scene-runtime.cjs`、`verify-entry-icon-fallbacks.cjs`）需要开发服务；生产验收应先构建，再在预览地址运行兼容构建产物的布局、交互、降级及历史返回脚本。

普通导航验收从页面入口读取实际地址，并在浏览器网络边界提供本地目的页；未匹配的外部请求应中止，不能让测试访问真实站点。`verify-static-links.cjs` 用于核对自定义配置，调用前需在测试页 URL 中显式传入 URL 编码后的 `expectedBlogUrl` 和 `expectedWorldUrl`，不能省略第二个预期值。主页画布用 `#scene canvas` 定位，避免误读入口图标或落墨画布。

Playwright CLI 不在项目 npm 依赖中，`npm test` 不会自动执行这些浏览器脚本。自动化通过仅表示所测环境中的结果；手机视口模拟不能代替 iPhone Safari 等实际设备验收，兼容性与性能结论需附浏览器、设备及测试范围。

## 常见问题

| 问题 | 处理方式 |
| --- | --- |
| Node 报未知参数或不支持语法 | 检查 `node --version` 与实际执行路径，使用推荐的 Node.js 22.18+，再按锁文件安装 |
| 双击 HTML 后空白或出现占位符 | 使用 Vite 开发服务或构建后的 HTTP 静态服务；源码 HTML 需要 Vite 转换，不能通过 `file://` 使用 |
| 只看到静态背景 | 检查控制台、WebGL、资源请求和加载错误；这是降级路径，文字入口应仍可访问 |
| 入口地址不符合预期 | 核对 `src/config.ts` 中的 `blogUrl` 和 `worldUrl`，修改后重新构建部署 |
| 修改文案后缺字或构建失败 | 同步行书字形；标题与题词按各自资源维护，详见字形与素材维护 |
| 子目录部署后图片丢失 | 排查根绝对资源路径；仅修改 Vite `base` 无法覆盖全部 `/assets/` 引用 |

## 贡献与授权

提交缺陷、建议或代码前请阅读 [贡献指南](CONTRIBUTING.md)，并使用仓库中的 Issue / PR 模板描述复现与验证情况。

项目原创代码与文档采用 [MIT License](LICENSE)，Copyright (c) 2026 Klaus-Kin。第三方影像、字体及衍生字形遵循各自授权，不因本仓库使用 MIT 而改变；来源与保留要求见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
