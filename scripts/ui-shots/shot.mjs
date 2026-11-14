// DevGo 文档截图流水线（零依赖：Node 22 + Chrome for Testing + 原生 CDP）
//
// 用法：
//   pnpm shots                       # en/light 一组
//   pnpm shots -- --lang zh-CN --theme dark
//   pnpm shots -- --all              # 2 语言 × 2 明暗 全矩阵
//   pnpm shots:sync                  # 产物按版本目录拷进文档仓（默认 ../dev-go-docs）
//
// 输出：<OUT>/{lang}/{theme}/{scene}.png，同名 report.json 带 i18n 审计结果。
// 场景与文档页面的对应关系见 scripts/ui-shots/README.md。

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')

// ---------- 参数 ----------
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : (process.env[name] ?? fallback)
}
const ALL = process.argv.includes('--all')
const LANG = arg('lang', 'en')
const THEME = arg('theme', 'light') === 'dark' || process.env.DARK === '1' ? 'dark' : 'light'
const OUT = resolve(repo, arg('out', '.output/ui-preview/docs'))
const EXT = resolve(repo, arg('ext', '.output/chrome-mv3'))
const CHROME = arg('chrome', '') || findChromeForTesting()
const SECTIONS = (
  arg('sections', '') || 'translate,models,selection,assistant,network,enhance,general'
).split(',')
// 慢机器上放慢等待：SCALE=1.5
const SCALE = Number(arg('scale', '1'))

// --all：串行跑全矩阵
if (ALL) {
  for (const lang of ['zh-CN', 'en']) {
    for (const theme of ['light', 'dark']) {
      console.error(`\n=== ${lang} / ${theme} ===`)
      const r = spawnSync(
        process.execPath,
        [import.meta.filename, '--lang', lang, '--theme', theme],
        {
          stdio: 'inherit',
        },
      )
      if (r.status !== 0) process.exit(r.status ?? 1)
    }
  }
  process.exit(0)
}

if (!CHROME || !existsSync(CHROME)) {
  console.error('找不到 Chrome for Testing，请用 --chrome 指定可执行文件路径')
  process.exit(1)
}
if (!existsSync(EXT)) {
  console.error(`找不到扩展构建产物 ${EXT}，先 pnpm build 或用 --ext 指定`)
  process.exit(1)
}

// ---------- 工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SCALE))

/** 在 ~/.omp/puppeteer 或 ~/Library/Caches 下自动发现 Chrome for Testing */
function findChromeForTesting() {
  const roots = [
    resolve(process.env.HOME ?? '', '.omp/puppeteer/chrome'),
    resolve(process.env.HOME ?? '', 'Library/Caches/puppeteer/chrome'),
  ]
  const suffix = join(
    'chrome-mac-arm64',
    'Google Chrome for Testing.app',
    'Contents/MacOS/Google Chrome for Testing',
  )
  for (const root of roots) {
    if (!existsSync(root)) continue
    const versions = readdirSync(root)
      .filter((d) => d.startsWith('mac_') || /^\d/.test(d))
      .sort()
      .reverse()
    for (const v of versions) {
      for (const cand of [join(root, v, suffix), join(root, v, 'chrome-mac', suffix)]) {
        if (existsSync(cand)) return cand
      }
    }
  }
  return ''
}

/** 起一个静态服务托管 fixture 演示页，返回 { origin, close } */
async function serveFixture() {
  const root = join(here, 'fixture')
  const server = createServer((req, res) => {
    const path = req.url === '/' || req.url === '/index.html' ? '/index.html' : req.url
    const file = join(root, path)
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404).end('not found')
      return
    }
    const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.css': 'text/css' }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() }
}

// ---------- 启动浏览器 ----------
const DEBUG_PORT = 9400 + Math.floor(Math.random() * 400)
const profile = join(process.env.TMPDIR ?? '/tmp', `devgo-shots-${LANG}-${THEME}-${DEBUG_PORT}`)
rmSync(profile, { recursive: true, force: true })
const outDir = join(OUT, LANG, THEME)
mkdirSync(outDir, { recursive: true })

const fixture = await serveFixture()
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    `--lang=${LANG}`,
    `--accept-lang=${LANG}`,
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1400,900',
    'about:blank',
  ],
  {
    stdio: 'ignore',
    env: { ...process.env, LANG: LANG === 'en' ? 'en_US.UTF-8' : 'zh_CN.UTF-8' },
  },
)
process.on('exit', () => {
  chrome.kill()
  fixture.close()
})
await sleep(3500)

// 找到我们的扩展 id：浏览器自带组件扩展也有 background.js，需按 manifest 的 homepage_url 过滤
let extId = ''
for (let i = 0; i < 20 && !extId; i++) {
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()
  for (const t of targets.filter(
    (x) => x.type === 'service_worker' && /\/background\.js$/.test(x.url),
  )) {
    const sw = new WebSocket(t.webSocketDebuggerUrl)
    await new Promise((r) => (sw.onopen = r))
    const res = await new Promise((r) => {
      sw.onmessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.id === 1) r(m)
      }
      sw.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: 'chrome.runtime.getManifest().homepage_url', returnByValue: true },
        }),
      )
    })
    sw.close()
    if (String(res.result?.result?.value).includes('wangrongding')) extId = t.url.split('/')[2]
  }
  if (!extId) await sleep(500)
}
if (!extId) {
  console.error('未找到扩展 service worker，加载失败？')
  chrome.kill()
  process.exit(1)
}

let ws
let seq = 0
const pending = new Map()
const wirePage = async () => {
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Page.javascriptDialogOpening')
      void send('Page.handleJavaScriptDialog', { accept: true })
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
}
await wirePage()
const send = (method, params = {}, timeoutMs = 25000 * SCALE) =>
  new Promise((r) => {
    seq += 1
    const my = seq
    pending.set(my, r)
    ws.send(JSON.stringify({ id: my, method, params }))
    setTimeout(() => {
      if (pending.has(my)) {
        console.error('timeout', method)
        pending.delete(my)
        r({})
      }
    }, timeoutMs)
  })
const ev = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
    ?.result?.value

await send('Page.enable')
await send('Runtime.enable')
const base = `chrome-extension://${extId}`

const go = async (path, w, h) => {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await send('Page.navigate', { url: base + path })
  await sleep(1600)
}

// i18n 审计：残留中文、被截断的文字、横向溢出的元素（英文界面才查残留中文）
const audit = () =>
  ev(`(() => {
    const han = []
    const truncated = []
    const overflow = []
    for (const el of document.querySelectorAll('body *')) {
      const t = (el.childNodes.length && [...el.childNodes].every(n => n.nodeType === 3) ? el.textContent : '')
      if (t && t.trim()) {
        if ('${LANG}' === 'en' && /[\\u4e00-\\u9fff]/.test(t)) han.push(el.textContent.trim().slice(0, 40))
        if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflow !== 'visible') truncated.push(el.className.toString().slice(0, 40))
      }
      const r = el.getBoundingClientRect()
      if (r.width && r.right > innerWidth + 1) overflow.push(el.className.toString().slice(0, 40))
    }
    return { han: [...new Set(han)], truncated: [...new Set(truncated)], overflow: [...new Set(overflow)] }
  })()`)

const report = {}
const shot = async (name, opts = {}) => {
  console.error('shot', name)
  const params = { format: 'png' }
  if (opts.rect) {
    // 按面板元素实际边界裁切（clip 用 CSS 像素，DPR 由 Emulation 自动放大）
    params.clip = {
      x: opts.rect.x,
      y: opts.rect.y,
      width: opts.rect.width,
      height: opts.rect.height,
      scale: 1,
    }
    params.captureBeyondViewport = true
  } else if (opts.full) {
    const h = await ev('document.documentElement.scrollHeight')
    const w = await ev('document.documentElement.clientWidth')
    params.clip = { x: 0, y: 0, width: w, height: Math.min(h, 4000), scale: 1 }
    params.captureBeyondViewport = true
  }
  let data = (await send('Page.captureScreenshot', params))?.result?.data ?? ''
  if (!data) {
    // 新标签页等重渲染页面偶发超时，等一拍重试一次
    await sleep(1200)
    data = (await send('Page.captureScreenshot', params))?.result?.data ?? ''
  }
  if (!data) {
    console.error(`screenshot failed: ${name}`)
    report[name] = { han: ['<capture-failed>'], truncated: [], overflow: [] }
    return
  }
  writeFileSync(
    join(outDir, `${name}.png`),
    Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
  )
  report[name] = await audit()
}

// ---------- 场景 ----------
// 界面语言跟随浏览器、按参数设主题
await go('/options.html', 1280, 900)
console.error('ui lang', await ev('chrome.i18n.getUILanguage() + " " + navigator.language'))
await ev(
  `chrome.storage.local.set({ uiLanguage: '${LANG}', themeMode: '${THEME}', newtabShaderMode: 'fixed' })`,
)

// 弹窗 4 个 Tab（复用「记住上次 Tab」的存储键）：按 .popup-shell 实际高度裁切，去掉底部空白
for (const tab of ['translate', 'network', 'tools', 'function']) {
  await go('/options.html', 1280, 900)
  await ev(`chrome.storage.local.set({ popupLastActiveTab: '${tab}', popupInitialTab: '' })`)
  await go('/popup.html', 500, 640)
  const rect = await ev(
    "(() => { const s = document.querySelector('.popup-shell'); const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()",
  )
  await shot(`popup-${tab}`, rect ? { rect } : {})
}

// 设置页各分区（整页长图）
for (const sec of SECTIONS) {
  await go(`/options.html#${sec}`, 1280, 900)
  await shot(`options-${sec}`, { full: true })
}

// 侧边栏 AI 助手
await go('/sidepanel.html', 420, 800)
await shot('sidepanel')

// 网页场景：划词工具条 + 悬浮快捷栏（fixture 演示页，CDP 模拟真实拖选）
// 放在动态背景的新标签页之前：个别情况下新标签页会让页面假死，重要场景先拍完
try {
  await send('Emulation.setEmulatedMedia', { features: [] })
  await send('Page.navigate', { url: `${fixture.origin}/index.html` })
  await sleep(2500)
  const box = await ev(
    "(() => { const r = document.querySelector('#p1').getBoundingClientRect(); return { x: r.left + 10, y: r.top + 12 } })()",
  )
  if (!box) throw new Error('fixture #p1 not found')
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: box.x,
    y: box.y,
    button: 'left',
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: box.x + 330,
    y: box.y + 28,
    button: 'left',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: box.x + 330,
    y: box.y + 28,
    button: 'left',
    clickCount: 1,
  })
  await sleep(1200)
  await shot('page-selection')

  // 悬停悬浮球展开快捷栏
  const ball = await ev(
    "(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.tagName.toLowerCase().includes('dock')); const b = host?.shadowRoot.querySelector('button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()",
  )
  if (ball) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ball.x, y: ball.y })
    await sleep(900)
    await shot('page-dock')
  } else {
    console.error('未找到悬浮球（dock 被停用？）')
  }
} catch (error) {
  console.error('page scenes failed:', error)
}

// 新标签页放在最后：禁 WebGL 动态背景 + 减少动效；深色模式下偶发页面假死，失败只丢这一张
try {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      'const __gc = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...a) { return /webgl/.test(type) ? null : __gc.call(this, type, ...a) }',
  })
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await go('/newtab.html', 1280, 800)
  await sleep(800)
  await ev(
    "document.getAnimations().forEach((a) => a.cancel()); document.querySelectorAll('canvas').forEach((c) => c.remove())",
  )
  await sleep(500)
  await shot('newtab')
} catch (error) {
  console.error('newtab scene failed:', error)
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1))
console.log(
  `${LANG}/${THEME}: ${Object.keys(report).length} shots -> ${outDir}\n` +
    JSON.stringify(
      Object.fromEntries(
        Object.entries(report).map(([k, v]) => [
          k,
          { han: v.han.length, trunc: v.truncated.length, overflow: v.overflow.length },
        ]),
      ),
    ),
)
chrome.kill()
fixture.close()
rmSync(profile, { recursive: true, force: true })
process.exit(0)
