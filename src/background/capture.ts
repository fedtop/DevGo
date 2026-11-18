/**
 * 网页导出：整页或选中区域 → 与屏幕显示一致的 PNG / PDF。
 *
 * 按浏览器实际渲染的画面分块截取再拼接，而不是走打印：打印会套用 print 样式、按纸张宽度重排，
 * 导出来和屏幕上看到的不一样。代价是 PDF 里是图片，文字不能选中。
 * - Chrome：逐屏滚动 + tabs.captureVisibleTab 拼接（<all_urls> 已覆盖，不需要额外权限；
 *   debugger 不能声明成可选权限，改成必需权限会让老用户更新后扩展被停用）；
 * - Firefox：tabs.captureTab 直接按页面坐标截取视口外的区域。
 */

import { t } from '@/utils/i18n'
import type { CaptureFormat, CaptureRect, CaptureResult } from '@/utils/messaging'

const DOWNLOAD_DIR = 'DevGo-Export'
/** 单块截图的最大高度（设备像素），太高的截图在部分显卡上会空白 */
const MAX_TILE_PX = 4000
/** 单张画布的像素上限（面积 / 边长），超过时按比例缩小 */
const MAX_CANVAS_AREA = 100_000_000
const MAX_CANVAS_SIDE = 32_000
/** PDF 单页最大 14400pt（PDF 规范上限），按 96dpi 换算成 CSS 像素 */
const PDF_MAX_PAGE_CSS = 19_200
const PX_TO_PT = 0.75
/** captureVisibleTab 每秒最多调用 2 次，两次之间留出余量 */
const VISIBLE_CAPTURE_INTERVAL_MS = 550

/** Firefox 有 tabs.captureTab（可按页面坐标截取视口外区域），Chrome 没有 */
type CaptureTab = (
  tabId: number,
  options: { format: 'png'; rect: CaptureRect; scale: number },
) => Promise<string>

function getCaptureTab(): CaptureTab | undefined {
  return (browser.tabs as unknown as { captureTab?: CaptureTab }).captureTab
}

interface PageInfo {
  title: string
  viewportWidth: number
  contentHeight: number
  dpr: number
}

class CaptureError extends Error {}

function isRestrictedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /cannot access|cannot be scripted|cannot attach|extensions gallery|chrome:\/\/|missing host permission/i.test(
    message,
  )
}

async function runInPage<T, A extends unknown[] = []>(
  tabId: number,
  func: (...args: A) => T | Promise<T>,
  ...args: A
): Promise<T> {
  try {
    const [injection] = await browser.scripting.executeScript({ target: { tabId }, func, args })
    return injection?.result as T
  } catch (error) {
    if (isRestrictedError(error)) throw new CaptureError(t('capture.errors.restricted'))
    throw error
  }
}

async function readPageInfo(tabId: number): Promise<PageInfo> {
  return runInPage(tabId, () => ({
    title: document.title,
    viewportWidth: document.documentElement.clientWidth || window.innerWidth,
    contentHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
      window.innerHeight,
    ),
    dpr: window.devicePixelRatio || 1,
  }))
}

/**
 * 截图期间隐藏 DevGo 自己挂在网页上的界面（悬浮快捷栏、划词工具条、区域选择器）。
 * 注入函数会被序列化到网页里执行，不能引用这里的常量，样式 id 只能写字面量。
 */
async function setDevgoUiHidden(tabId: number, hidden: boolean): Promise<void> {
  // WXT 的 shadow 宿主带 :host { all: initial !important }，外部样式（包括行内 !important）压不过它，
  // 只能往各自的 shadow root 里追加一条更靠后的 :host 规则
  const toggle = (hide: boolean) => {
    for (const host of document.querySelectorAll(
      'devgo-dock-ui, devgo-selection-ui, devgo-capture-picker, devgo-toast',
    )) {
      const root = host.shadowRoot
      if (!root) continue
      root.querySelector('style[data-devgo-capture-hide]')?.remove()
      if (!hide) continue
      const style = document.createElement('style')
      style.dataset.devgoCaptureHide = ''
      style.textContent = ':host { display: none !important; }'
      root.append(style)
    }
  }
  const run = runInPage(tabId, toggle, hidden)
  await (hidden ? run : run.catch(() => undefined))
}

/**
 * 把整页从上到下滚一遍再回到原位：触发懒加载的图片（只在进入视口时才加载的那种），
 * 否则视口外的图片截出来是空白占位。
 */
async function preloadLazyContent(tabId: number): Promise<void> {
  await runInPage(tabId, async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const startX = window.scrollX
    const startY = window.scrollY
    const step = Math.max(window.innerHeight * 0.9, 400)
    const total = document.documentElement.scrollHeight
    for (let y = 0, count = 0; y < total && count < 40; y += step, count++) {
      window.scrollTo({ left: startX, top: y, behavior: 'instant' })
      await wait(90)
    }
    window.scrollTo({ left: startX, top: startY, behavior: 'instant' })
    // 等新出现的图片解码完成（最多 1.5 秒）
    const pending = [...document.images].filter((img) => !img.complete)
    await Promise.race([
      Promise.all(pending.map((img) => img.decode().catch(() => undefined))),
      wait(1500),
    ])
  })
}

/** 网页里一段排在同一行的文字及其位置（文档坐标，CSS 像素） */
interface TextRun {
  text: string
  x: number
  y: number
  width: number
  height: number
  /** 字号（CSS 像素） */
  size: number
  /** 每个字符（码点）的左边缘相对 x 的偏移，用来在 PDF 里逐字对齐 */
  offsets: number[]
}

/**
 * 收集区域内可见文字的位置，用来给图片式 PDF 叠一层透明文字：画面仍是截图，但文字能选中、复制、搜索。
 * 在滚动到顶部时测量：吸顶 / 固定定位的元素这时的位置正好是截图第一屏里的位置。
 * onlyInside 为 true 时（框选导出）跳过固定定位的元素（截图时它们被隐藏了），选中元素里的除外。
 * 注入网页执行，不能引用外部变量。
 */
async function collectTextRuns(
  region: { x: number; y: number; width: number; height: number },
  onlyInside: boolean,
): Promise<TextRun[]> {
  const startX = window.scrollX
  const startY = window.scrollY
  window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

  const target = document.querySelector('[data-devgo-capture-target]')
  const fixedCache = new Map<Element, boolean>()
  /** 是否在截图时被隐藏的固定定位元素里 */
  const inHiddenFixed = (element: Element): boolean => {
    if (!onlyInside) return false
    const chain: Element[] = []
    let node: Element | null = element
    let result = false
    while (node && node !== document.body) {
      const cached = fixedCache.get(node)
      if (cached !== undefined) {
        result = cached
        break
      }
      chain.push(node)
      const position = getComputedStyle(node).position
      if (
        (position === 'fixed' || position === 'sticky') &&
        !(target && (node.contains(target) || target.contains(node)))
      ) {
        result = true
        break
      }
      node = node.parentElement
    }
    for (const item of chain) fixedCache.set(item, result)
    return result
  }

  const runs: TextRun[] = []
  const right = region.x + region.width
  const bottom = region.y + region.height
  const inRegion = (r: {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }) =>
    r.width > 0 &&
    r.height > 0 &&
    r.right > region.x &&
    r.left < right &&
    r.bottom > region.y &&
    r.top < bottom
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!node.nodeValue?.trim() || !parent) return NodeFilter.FILTER_REJECT
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|TEMPLATE)$/.test(parent.tagName)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const range = document.createRange()

  for (let node = walker.nextNode(); node && runs.length < 20000; node = walker.nextNode()) {
    const parent = node.parentElement as HTMLElement
    const style = getComputedStyle(parent)
    if (style.visibility !== 'visible' || Number(style.opacity) === 0) continue
    if (inHiddenFixed(parent)) continue
    // 只给读屏软件看的文字（visually-hidden：1px 大小或整块裁掉），画面上看不到
    const parentBox = parent.getBoundingClientRect()
    if (parentBox.width <= 1 || parentBox.height <= 1) continue
    if (
      style.clipPath === 'inset(50%)' ||
      /^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(style.clip)
    ) {
      continue
    }
    const size = Number.parseFloat(style.fontSize) || 16
    const data = node.nodeValue ?? ''

    // 逐个字符量位置，按所在行切成多段：选中高亮能逐字对上画面，中英混排也不会错位
    let current: TextRun | null = null
    const flush = () => {
      if (current && current.text.trim()) {
        const box = {
          left: current.x,
          top: current.y,
          right: current.x + current.width,
          bottom: current.y + current.height,
          width: current.width,
          height: current.height,
        }
        if (inRegion(box)) runs.push(current)
      }
      current = null
    }
    for (let i = 0; i < data.length;) {
      const char = String.fromCodePoint(data.codePointAt(i) ?? 32)
      range.setStart(node, i)
      range.setEnd(node, i + char.length)
      i += char.length
      const r = range.getBoundingClientRect()
      if (!r.width || !r.height) {
        // 折叠掉的空白：保留一个空格作为词间隔，不占宽度
        if (current && !/\s$/.test(current.text)) {
          current.text += ' '
          current.offsets.push(current.width)
        }
        continue
      }
      if (
        !current ||
        Math.abs(r.top - current.y) > r.height / 2 ||
        r.left < current.x + current.width - 1
      ) {
        flush()
        current = {
          text: char,
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          size,
          offsets: [0],
        }
      } else {
        current.text += /\s/.test(char) ? ' ' : char
        current.offsets.push(r.left - current.x)
        current.width = r.right - current.x
        current.height = Math.max(current.height, r.bottom - current.y)
      }
    }
    flush()
  }

  window.scrollTo({ left: startX, top: startY, behavior: 'instant' })
  return runs
}

/**
 * 截取页面上一块区域（文档坐标），返回位图。
 * maxHeight：单块最高多少 CSS 像素（Chrome 逐屏截取，不能超过一屏）。
 */
interface TileCapturer {
  maxHeight: number
  capture(rect: CaptureRect, scale: number): Promise<ImageBitmap>
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}

/**
 * 隐藏 / 恢复网页里固定定位与吸顶的元素（导航栏、悬浮按钮等）：逐屏截取时它们会在每一屏重复出现。
 * 区域选择器选中的元素（带 data-devgo-capture-target）及其祖先、后代不动。
 */
function toggleFixedElements(hide: boolean) {
  const MARK = 'devgoCaptureFixed'
  if (!hide) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-devgo-capture-fixed]')) {
      const previous = el.dataset[MARK] ?? ''
      if (previous) el.style.setProperty('visibility', previous)
      else el.style.removeProperty('visibility')
      delete el.dataset[MARK]
    }
    return
  }
  const target = document.querySelector('[data-devgo-capture-target]')
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    if (el.tagName.startsWith('DEVGO-')) continue
    const position = getComputedStyle(el).position
    if (position !== 'fixed' && position !== 'sticky') continue
    if (target && (el.contains(target) || target.contains(el))) continue
    el.dataset[MARK] = el.style.getPropertyValue('visibility')
    el.style.setProperty('visibility', 'hidden', 'important')
  }
}

/** 滚到指定位置并等画面刷新，返回实际的滚动位置与视口尺寸 */
async function scrollForCapture(x: number, y: number) {
  window.scrollTo({ left: x, top: y, behavior: 'instant' })
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await new Promise((resolve) => setTimeout(resolve, 120))
  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }
}

let lastVisibleCaptureAt = 0

async function withTileCapturer<T>(
  tabId: number,
  dpr: number,
  options: { hideFixed: 'after-first' | 'always' },
  run: (capturer: TileCapturer) => Promise<T>,
): Promise<T> {
  const captureTab = getCaptureTab()
  if (captureTab) {
    return run({
      maxHeight: Number.POSITIVE_INFINITY,
      capture: (rect, scale) =>
        captureTab(tabId, { format: 'png', rect, scale: dpr * scale })
          .then(dataUrlToBlob)
          .then((blob) => createImageBitmap(blob)),
    })
  }

  const tab = await browser.tabs.get(tabId)
  if (!tab.active || tab.windowId == null) throw new CaptureError(t('capture.errors.notActive'))
  const windowId = tab.windowId
  const start = await runInPage(tabId, () => ({
    x: window.scrollX,
    y: window.scrollY,
    h: window.innerHeight,
  }))

  let captured = 0
  let fixedHidden = false
  const hideFixed = async () => {
    if (fixedHidden) return
    fixedHidden = true
    await runInPage(tabId, toggleFixedElements, true)
  }

  try {
    if (options.hideFixed === 'always') await hideFixed()
    return await run({
      maxHeight: start.h,
      capture: async (rect) => {
        // 页面模式：第一屏保留吸顶导航，之后各屏隐藏，避免重复出现
        if (captured === 1) await hideFixed()
        const view = await runInPage(tabId, scrollForCapture, rect.x, rect.y)
        const wait = lastVisibleCaptureAt + VISIBLE_CAPTURE_INTERVAL_MS - Date.now()
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
        lastVisibleCaptureAt = Date.now()
        const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' })
        captured++
        const full = await createImageBitmap(await dataUrlToBlob(dataUrl))
        const ratio = full.width / view.viewportWidth
        const crop = await createImageBitmap(
          full,
          Math.round((rect.x - view.scrollX) * ratio),
          Math.round((rect.y - view.scrollY) * ratio),
          Math.max(1, Math.round(rect.width * ratio)),
          Math.max(1, Math.round(rect.height * ratio)),
        )
        full.close()
        return crop
      },
    })
  } finally {
    if (fixedHidden) await runInPage(tabId, toggleFixedElements, false).catch(() => undefined)
    await runInPage(
      tabId,
      (x: number, y: number) => {
        window.scrollTo({ left: x, top: y, behavior: 'instant' })
      },
      start.x,
      start.y,
    ).catch(() => undefined)
  }
}

/** 按画布上限算缩放比例（1 = 按屏幕的设备像素比原样输出） */
function fitScale(width: number, height: number, dpr: number): number {
  const w = width * dpr
  const h = height * dpr
  return Math.min(
    1,
    Math.sqrt(MAX_CANVAS_AREA / Math.max(1, w * h)),
    MAX_CANVAS_SIDE / Math.max(1, h),
    MAX_CANVAS_SIDE / Math.max(1, w),
  )
}

/** 最小的 CSS 像素步长，使其乘以设备像素比后是整数（1.5x 屏是 2，1.25x 屏是 4） */
function pixelAlignedUnit(dpr: number): number {
  for (let unit = 1; unit <= 8; unit++) {
    if (Math.abs(dpr * unit - Math.round(dpr * unit)) < 0.01) return unit
  }
  return 1
}

/** 分块截取一块区域并拼到一张画布上 */
async function renderRegion(
  capturer: TileCapturer,
  rect: CaptureRect,
  dpr: number,
): Promise<OffscreenCanvas> {
  const scale = fitScale(rect.width, rect.height, dpr)
  const k = dpr * scale
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(rect.width * k)),
    Math.max(1, Math.round(rect.height * k)),
  )
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 每块的高度取「乘以像素比后是整数」的 CSS 像素，滚动位置落在整像素上，块与块之间不会错位
  const unit = pixelAlignedUnit(dpr)
  // 留出一个步长给接缝处的重叠
  const limit = Math.min(capturer.maxHeight - unit, Math.floor(MAX_TILE_PX / k))
  const tileCss = Math.max(unit, Math.floor(limit / unit) * unit)
  for (let offset = 0; offset < rect.height; offset += tileCss) {
    const height = Math.min(tileCss, rect.height - offset)
    // 非最后一块多截一点，下一块从上面盖住，避免取整误差在接缝处漏出一条白线
    const overlap = offset + height < rect.height ? unit : 0
    const bitmap = await capturer.capture(
      { x: rect.x, y: rect.y + offset, width: rect.width, height: height + overlap },
      scale,
    )
    const top = Math.round(offset * k)
    const bottom = Math.round((offset + height + overlap) * k)
    ctx.drawImage(bitmap, 0, top, canvas.width, bottom - top)
    bitmap.close()
  }
  return canvas
}

function encodeAscii(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** zlib 格式压缩，正好是 PDF 的 FlateDecode */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const compressed = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(compressed).arrayBuffer())
}

/** PDF 页上的一段透明文字（页面坐标，pt，原点在左下角，y 为基线） */
interface PdfTextRun {
  text: string
  x: number
  y: number
  size: number
  width: number
  /** 每个字符相对 x 的偏移（pt） */
  offsets: number[]
}

interface PdfPage {
  jpeg: Uint8Array
  pxWidth: number
  pxHeight: number
  ptWidth: number
  ptHeight: number
  texts: PdfTextRun[]
}

/**
 * 透明文字层的内容流：渲染模式 3（不可见），不改变画面。
 * 每个字符按网页里量到的位置用 TJ 逐字校正，选中高亮能对上画面里的字。
 */
function buildTextLayer(texts: PdfTextRun[]): string {
  const parts: string[] = []
  for (const run of texts) {
    if (run.size <= 0) continue
    const chars = [...run.text]
    const ops: string[] = [
      `/F1 ${run.size.toFixed(2)} Tf 1 0 0 1 ${run.x.toFixed(2)} ${run.y.toFixed(2)} Tm`,
    ]
    // 字体宽度统一是 1em：每个字用 Tz 横向缩放到它在网页里实际占的宽度，
    // 字形宽度和画面一致，选中高亮能逐字对上，提取文字时也不会多出 / 丢掉空格。连续同宽的字合成一段
    let scale = Number.NaN
    let hex = ''
    const emit = () => {
      if (hex) ops.push(`${scale.toFixed(2)} Tz <${hex}> Tj`)
      hex = ''
    }
    chars.forEach((char, index) => {
      const offset = run.offsets[index] ?? 0
      const next = index + 1 < chars.length ? (run.offsets[index + 1] ?? run.width) : run.width
      // 用 UTF-16 码元当字形编号（Identity-H），ToUnicode 原样映射回来；超出 BMP 的字符（如 emoji）换成空格占位
      const code = char.codePointAt(0) ?? 32
      const glyph = (code > 0xffff ? 32 : code).toString(16).padStart(4, '0')
      const charScale = Math.max(0, ((next - offset) / run.size) * 100)
      if (Number.isNaN(scale) || Math.abs(charScale - scale) > 0.005) {
        emit()
        scale = charScale
      }
      hex += glyph
    })
    emit()
    parts.push(ops.join(' '))
  }
  return parts.length ? `\nBT 3 Tr\n${parts.join('\n')}\nET` : ''
}

/** 逐个 16 位编码原样映射成 Unicode 的 ToUnicode CMap（bfrange 只能在低字节内变化，按高字节分 256 段） */
function buildIdentityToUnicode(): string {
  const ranges: string[] = []
  for (let high = 0; high < 256; high++) {
    const prefix = high.toString(16).padStart(2, '0')
    ranges.push(`<${prefix}00> <${prefix}ff> <${prefix}00>`)
  }
  const blocks: string[] = []
  for (let i = 0; i < ranges.length; i += 100) {
    const chunk = ranges.slice(i, i + 100)
    blocks.push(`${chunk.length} beginbfrange\n${chunk.join('\n')}\nendbfrange`)
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <ffff>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
}

/**
 * 把若干张 JPEG 按原尺寸各占一页，拼成一个最小可用的 PDF；
 * 每页叠一层透明文字（不可见、不改变画面），文字可以选中、复制和搜索。
 */
async function buildPdf(pages: PdfPage[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encodeAscii(data) : data
    chunks.push(bytes)
    length += bytes.length
  }
  const startObject = (id: number) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
  }
  /** 文本类的流用 Flate 压缩（逐字定位的文字层不压缩会很大） */
  const stream = async (id: number, body: string) => {
    const data = await deflate(encodeAscii(body))
    startObject(id)
    push(`<< /Filter /FlateDecode /Length ${data.length} >>\nstream\n`)
    push(data)
    push('\nendstream\nendobj\n')
  }

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  // 对象编号：1 目录、2 页面树、3–6 透明文字用的字体，之后每页 3 个对象（页面、内容流、图片）
  const FONT = 3
  const pageIds = pages.map((_, index) => 7 + index * 3)

  startObject(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  startObject(2)
  push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
  )

  // 字体只用于定位和提取文字，不嵌入字形（文字不可见，不需要画出来）
  startObject(FONT)
  push(
    `<< /Type /Font /Subtype /Type0 /BaseFont /DevGoTextLayer /Encoding /Identity-H /DescendantFonts [${FONT + 1} 0 R] /ToUnicode ${FONT + 3} 0 R >>\nendobj\n`,
  )
  startObject(FONT + 1)
  push(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DevGoTextLayer /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${FONT + 2} 0 R /DW 1000 /CIDToGIDMap /Identity >>\nendobj\n`,
  )
  startObject(FONT + 2)
  push(
    '<< /Type /FontDescriptor /FontName /DevGoTextLayer /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>\nendobj\n',
  )
  await stream(FONT + 3, buildIdentityToUnicode())

  for (const [index, page] of pages.entries()) {
    const pageId = pageIds[index]
    const contentId = pageId + 1
    const imageId = pageId + 2
    const w = page.ptWidth.toFixed(2)
    const h = page.ptHeight.toFixed(2)

    startObject(pageId)
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> /Font << /F1 ${FONT} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    )
    await stream(contentId, `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q${buildTextLayer(page.texts)}`)
    startObject(imageId)
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.pxWidth} /Height ${page.pxHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    )
    push(page.jpeg)
    push('\nendstream\nendobj\n')
  }

  const objectCount = 7 + pages.length * 3
  const xrefOffset = length
  push(`xref\n0 ${objectCount}\n0000000000 65535 f \n`)
  for (let id = 1; id < objectCount; id++) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  }
  push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let cursor = 0
  for (const chunk of chunks) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  return out
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

function buildFileName(title: string, format: CaptureFormat, suffix = ''): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base =
    title
      // 文件名里不允许的字符换成空格，控制字符直接去掉
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .split('')
      .filter((char) => char.charCodeAt(0) >= 0x20)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'page'
  return `${base}${suffix}-${stamp}.${format}`
}

async function download(bytes: Uint8Array, mime: string, fileName: string): Promise<void> {
  await browser.downloads.download({
    url: bytesToDataUrl(bytes, mime),
    filename: `${DOWNLOAD_DIR}/${fileName}`,
    conflictAction: 'uniquify',
  })
}

async function exportRegion(
  tabId: number,
  info: PageInfo,
  rect: CaptureRect,
  format: CaptureFormat,
  fileName: string,
  hideFixed: 'after-first' | 'always',
): Promise<void> {
  // PDF 要叠透明文字层：先在页面上量好文字位置（截图过程会滚动、隐藏元素，要在那之前量）
  const runs =
    format === 'pdf'
      ? await runInPage(tabId, collectTextRuns, rect, hideFixed === 'always').catch(
          (error: unknown) => {
            console.warn('[DevGo] collect text layer failed:', error)
            return [] as TextRun[]
          },
        )
      : []
  await withTileCapturer(tabId, info.dpr, { hideFixed }, async (capture) => {
    if (format === 'png') {
      const canvas = await renderRegion(capture, rect, info.dpr)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      await download(new Uint8Array(await blob.arrayBuffer()), 'image/png', fileName)
      return
    }

    // PDF：按单页上限切成多页，每页单独截取编码，避免一张超长画布占满内存
    const pages: PdfPage[] = []
    for (let offset = 0; offset < rect.height; offset += PDF_MAX_PAGE_CSS) {
      const height = Math.min(PDF_MAX_PAGE_CSS, rect.height - offset)
      const canvas = await renderRegion(capture, { ...rect, y: rect.y + offset, height }, info.dpr)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
      const top = rect.y + offset
      const ptHeight = height * PX_TO_PT
      pages.push({
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        pxWidth: canvas.width,
        pxHeight: canvas.height,
        ptWidth: rect.width * PX_TO_PT,
        ptHeight,
        texts: runs
          // 按文字中线归到所在页，跨页的那一行只出现一次
          .filter((run) => {
            const middle = run.y + run.height / 2
            return middle >= top && middle < top + height
          })
          .map((run) => ({
            text: run.text,
            x: (run.x - rect.x) * PX_TO_PT,
            offsets: run.offsets.map((value) => value * PX_TO_PT),
            // 基线大约在行框顶部往下 0.8 个字号处（PDF 的 y 轴从下往上）
            y: ptHeight - (run.y - top + run.height / 2 + run.size * 0.32) * PX_TO_PT,
            size: run.size * PX_TO_PT,
            width: run.width * PX_TO_PT,
          })),
      })
    }
    await download(await buildPdf(pages), 'application/pdf', fileName)
  })
}

function toResult(error: unknown): CaptureResult {
  console.warn('[DevGo] capture failed:', error)
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

async function resolveTabId(tabId?: number): Promise<number> {
  if (tabId != null) return tabId
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id == null) throw new CaptureError(t('capture.errors.noTab'))
  return tab.id
}

/** 导出整个网页 */
export async function capturePage(format: CaptureFormat, tabId?: number): Promise<CaptureResult> {
  try {
    const id = await resolveTabId(tabId)
    await setDevgoUiHidden(id, true)
    try {
      await preloadLazyContent(id)
      const info = await readPageInfo(id)
      const fileName = buildFileName(info.title, format)
      await exportRegion(
        id,
        info,
        { x: 0, y: 0, width: info.viewportWidth, height: info.contentHeight },
        format,
        fileName,
        'after-first',
      )
      return { ok: true, fileName }
    } finally {
      await setDevgoUiHidden(id, false)
    }
  } catch (error) {
    return toResult(error)
  }
}

/** 导出区域选择器选中的区域 */
export async function captureElement(
  tabId: number | undefined,
  rect: CaptureRect,
  format: CaptureFormat,
): Promise<CaptureResult> {
  try {
    if (tabId == null) throw new CaptureError(t('capture.errors.noTab'))
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    if (width < 1 || height < 1) throw new CaptureError(t('capture.errors.empty'))
    await setDevgoUiHidden(tabId, true)
    try {
      const info = await readPageInfo(tabId)
      const fileName = buildFileName(info.title, format, '-selection')
      await exportRegion(
        tabId,
        info,
        {
          x: Math.max(0, Math.round(rect.x)),
          y: Math.max(0, Math.round(rect.y)),
          // 逐屏截取只能拿到视口宽度以内的部分
          width: Math.min(width, info.viewportWidth),
          height,
        },
        format,
        fileName,
        'always',
      )
      return { ok: true, fileName }
    } finally {
      await setDevgoUiHidden(tabId, false)
    }
  } catch (error) {
    return toResult(error)
  }
}

/** 在网页里打开区域选择器 */
export async function startCapturePicker(tabId?: number): Promise<CaptureResult> {
  try {
    const id = await resolveTabId(tabId)
    await browser.scripting.executeScript({ target: { tabId: id }, files: ['/capture-picker.js'] })
    return { ok: true }
  } catch (error) {
    if (isRestrictedError(error)) return { ok: false, error: t('capture.errors.restricted') }
    return toResult(error)
  }
}
