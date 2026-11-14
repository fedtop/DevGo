# ui-shots：文档截图流水线

一条命令产出 DevGo 全部文档截图（Chrome for Testing 无头浏览器 + 原生 CDP，零 npm 依赖），并带 i18n 自查（英文界面残留中文、文字截断、横向溢出）。

## 用法

```bash
pnpm build                 # 先有构建产物（截图默认读 .output/chrome-mv3）
pnpm shots                 # 单组：en / light
pnpm shots -- --lang zh-CN --theme dark
pnpm shots -- --all        # 全矩阵：{zh-CN, en} × {light, dark}，约 10–15 分钟
pnpm shots:sync            # 按版本目录拷进文档仓（默认 ../dev-go-docs）
```

可选参数（CLI 或环境变量）：`--lang`、`--theme`、`--ext`（扩展目录）、`--chrome`（CFT 可执行文件，默认自动发现 `~/.omp/puppeteer` / `~/Library/Caches/puppeteer`）、`--out`、`--sections`、`--scale`（慢机器调成 1.5 放慢等待）。

## 场景清单（每组 15 张）

| 场景 | 文件名 | 说明 |
| --- | --- | --- |
| 弹窗 4 个 Tab | `popup-{translate,network,tools,function}.png` | 500×640 |
| 设置页 7 个分区 | `options-{translate,models,selection,assistant,network,enhance,general}.png` | 1280×900 整页长图 |
| 侧边栏 AI 助手 | `sidepanel.png` | 420×800 |
| 新标签页 | `newtab.png` | 自动禁 WebGL 背景与动效 |
| 划词工具条 | `page-selection.png` | fixture 演示页上 CDP 模拟真实拖选 |
| 悬浮快捷栏 | `page-dock.png` | 悬停悬浮球展开 |

需要交互/授权、暂未自动化的场景（如真实 IP 防护确认弹窗、划词结果面板、WebMCP 工具执行）留给人工补充，放 `docs/public/shots/{version}/manual/`。

## 输出与引用约定

- 产物：`.output/ui-preview/docs/{lang}/{theme}/{scene}.png`（gitignored）+ 同目录 `report.json`（i18n 自查结果，`han/trunc/overflow` 应全为 0，非 0 时先修再入库）。
- 文档页面统一引用 `/shots/0.2.3/zh-CN/light/popup-translate.png`（VitePress 会自动加站点 base，线上实际是 `/dev-go-docs/shots/...`；中文页面用 zh-CN 图，英文页面用 en 图；深色图在讲主题的页面用）。
- UI 改版后：重跑 `pnpm shots -- --all` → 改 `package.json` 版本号 → `pnpm shots:sync`，配文不用动，旧版本文档继续引用旧目录，永不腐烂。

## 新增场景

1. 在 `shot.mjs` 的「场景」段加一段（导航 → 交互 → `await shot('name')`）。
2. `fixture/index.html` 是统一的演示页：改场景尽量改 fixture，保证可复现。
3. 同步更新本 README 的场景清单和文档仓的引用。
