/**
 * 网页导出：整页或选中区域 → 与屏幕显示一致的 PNG / PDF。
 *
 * 按浏览器实际渲染的画面分块截取再拼接，而不是走打印：打印会套用 print 样式、按纸张宽度重排，
 * 导出来和屏幕上看到的不一样。代价是 PDF 里是图片，文字不能选中。
 * - Chrome：debugger 协议的 captureBeyondViewport 截视口外的部分（可选权限 debugger，首次使用时申请）；
 * - Firefox：tabs.captureTab 直接按页面坐标截取。
 */

import { t } from '@/utils/i18n'
import { getCaptureTab } from '@/utils/capture-permission'
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

/** 截取页面上一块区域（文档坐标），返回位图 */
type TileCapturer = (rect: CaptureRect, scale: number) => Promise<ImageBitmap>

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const blob = await (await fetch(dataUrl)).blob()
  return createImageBitmap(blob)
}

async function withTileCapturer<T>(
  tabId: number,
  dpr: number,
  run: (capture: TileCapturer) => Promise<T>,
): Promise<T> {
  const captureTab = getCaptureTab()
  if (captureTab) {
    return run((rect, scale) =>
      captureTab(tabId, { format: 'png', rect, scale: dpr * scale }).then(dataUrlToBitmap),
    )
  }

  if (!chrome.debugger) throw new CaptureError(t('capture.errors.unsupported'))
  const granted = await browser.permissions.contains({ permissions: ['debugger'] })
  if (!granted) throw new CaptureError(t('capture.errors.permission'))

  const target = { tabId }
  try {
    await chrome.debugger.attach(target, '1.3')
  } catch (error) {
    if (isRestrictedError(error)) throw new CaptureError(t('capture.errors.restricted'))
    throw error
  }
  try {
    return await run(async (rect, scale) => {
      const result = (await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { ...rect, scale },
      })) as { data?: string } | undefined
      if (!result?.data) throw new Error('captureScreenshot returned no data')
      return dataUrlToBitmap(`data:image/png;base64,${result.data}`)
    })
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined)
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

/** 分块截取一块区域并拼到一张画布上 */
async function renderRegion(
  capture: TileCapturer,
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

  const tileCss = Math.max(1, Math.floor(MAX_TILE_PX / k))
  for (let offset = 0; offset < rect.height; offset += tileCss) {
    const height = Math.min(tileCss, rect.height - offset)
    const bitmap = await capture(
      { x: rect.x, y: rect.y + offset, width: rect.width, height },
      scale,
    )
    const top = Math.round(offset * k)
    const bottom = Math.round((offset + height) * k)
    ctx.drawImage(bitmap, 0, top, canvas.width, bottom - top)
    bitmap.close()
  }
  return canvas
}

function encodeAscii(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** 把若干张 JPEG 按原尺寸各占一页，拼成一个最小可用的 PDF */
function buildPdf(
  pages: Array<{
    jpeg: Uint8Array
    pxWidth: number
    pxHeight: number
    ptWidth: number
    ptHeight: number
  }>,
): Uint8Array {
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

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  // 对象编号：1 目录、2 页面树，之后每页 3 个对象（页面、内容流、图片）
  const pageIds = pages.map((_, index) => 3 + index * 3)

  startObject(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  startObject(2)
  push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
  )

  pages.forEach((page, index) => {
    const pageId = pageIds[index]
    const contentId = pageId + 1
    const imageId = pageId + 2
    const w = page.ptWidth.toFixed(2)
    const h = page.ptHeight.toFixed(2)
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`

    startObject(pageId)
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    )
    startObject(contentId)
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
    startObject(imageId)
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.pxWidth} /Height ${page.pxHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    )
    push(page.jpeg)
    push('\nendstream\nendobj\n')
  })

  const objectCount = 3 + pages.length * 3
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
): Promise<void> {
  await withTileCapturer(tabId, info.dpr, async (capture) => {
    if (format === 'png') {
      const canvas = await renderRegion(capture, rect, info.dpr)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      await download(new Uint8Array(await blob.arrayBuffer()), 'image/png', fileName)
      return
    }

    // PDF：按单页上限切成多页，每页单独截取编码，避免一张超长画布占满内存
    const pages = []
    for (let offset = 0; offset < rect.height; offset += PDF_MAX_PAGE_CSS) {
      const height = Math.min(PDF_MAX_PAGE_CSS, rect.height - offset)
      const canvas = await renderRegion(capture, { ...rect, y: rect.y + offset, height }, info.dpr)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
      pages.push({
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        pxWidth: canvas.width,
        pxHeight: canvas.height,
        ptWidth: rect.width * PX_TO_PT,
        ptHeight: height * PX_TO_PT,
      })
    }
    await download(buildPdf(pages), 'application/pdf', fileName)
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
        { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width, height },
        format,
        fileName,
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
