/**
 * 网页区域选择器：由后台按需注入（弹窗「选择区域」、右键菜单）。
 * 鼠标悬停高亮元素，点击锁定后选导出图片 / PDF；↑ 选父节点、↓ 回到子节点、Esc 退出。
 * 导出前先把选择器自己藏起来，截图里不会带上高亮框。
 */
import { initI18n, t } from '@/utils/i18n'
import { sendRuntimeMessage, type CaptureFormat } from '@/utils/messaging'

const HOST_TAG = 'devgo-capture-picker'
const ACCENT = '#1783ff'

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.box { position: fixed; border: 2px solid ${ACCENT}; background: rgba(23, 131, 255, 0.08);
  border-radius: 3px; box-sizing: border-box; transition: all 60ms ease-out; display: none; }
.box.locked { background: rgba(23, 131, 255, 0.12); box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.28); }
.label { position: fixed; display: none; padding: 2px 8px; border-radius: 6px; background: ${ACCENT};
  color: #fff; font-size: 12px; white-space: nowrap; }
.hint { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); padding: 7px 14px;
  border-radius: 999px; background: rgba(17, 18, 22, 0.88); color: #fff; font-size: 13px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); white-space: nowrap; }
.bar { position: fixed; display: none; gap: 6px; padding: 6px; border-radius: 12px; background: #fff;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(15, 23, 42, 0.06); pointer-events: auto; }
.bar button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 8px; font-size: 13px;
  color: #1f2328; white-space: nowrap; }
.bar button:hover { background: #f1f3f5; }
.bar button.primary { background: #111216; color: #fff; }
.bar button.primary:hover { background: #2b2d33; }
.toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 9px 16px;
  border-radius: 10px; background: rgba(17, 18, 22, 0.92); color: #fff; font-size: 13px; max-width: 70vw; }
`

declare global {
  interface Window {
    __devgoCapturePicker?: boolean
  }
}

function describe(element: Element): string {
  const rect = element.getBoundingClientRect()
  const tag = element.tagName.toLowerCase()
  const id = element.id ? `#${element.id}` : ''
  const cls =
    !id && typeof element.className === 'string' && element.className.trim()
      ? `.${element.className.trim().split(/\s+/)[0]}`
      : ''
  return `${tag}${id}${cls}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`
}

async function startPicker() {
  if (window.__devgoCapturePicker) return
  window.__devgoCapturePicker = true
  await initI18n()

  const host = document.createElement(HOST_TAG)
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>${STYLE}</style>
    <div class="layer">
      <div class="box"></div>
      <div class="label"></div>
      <div class="hint"></div>
      <div class="bar">
        <button class="primary" data-action="png"></button>
        <button class="primary" data-action="pdf"></button>
        <button data-action="repick"></button>
        <button data-action="cancel"></button>
      </div>
    </div>`
  document.documentElement.append(host)

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T
  const box = $('.box')
  const label = $('.label')
  const hint = $('.hint')
  const bar = $('.bar')
  const layer = $('.layer')
  hint.textContent = t('capture.picker.hint')
  $('[data-action=png]').textContent = t('capture.picker.exportPng')
  $('[data-action=pdf]').textContent = t('capture.picker.exportPdf')
  $('[data-action=repick]').textContent = t('capture.picker.repick')
  $('[data-action=cancel]').textContent = t('capture.picker.cancel')

  let current: Element | null = null
  /** ↑ 选过的子节点，↓ 时按原路回去 */
  let trail: Element[] = []
  let locked = false
  let frame = 0

  const inPicker = (event: Event) => event.composedPath().includes(host)

  const render = () => {
    frame = requestAnimationFrame(render)
    if (!current || !current.isConnected) {
      box.style.display = label.style.display = 'none'
      return
    }
    const rect = current.getBoundingClientRect()
    Object.assign(box.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    label.textContent = describe(current)
    // 锁定后显示操作条，尺寸标签收起，免得和操作条叠在一起
    label.style.display = locked ? 'none' : 'block'
    const labelTop = rect.top - 26 >= 0 ? rect.top - 26 : rect.top + 4
    Object.assign(label.style, {
      left: `${Math.max(4, rect.left)}px`,
      top: `${labelTop}px`,
    })
    if (locked) {
      bar.style.display = 'flex'
      const barHeight = bar.offsetHeight || 40
      const below = rect.bottom + 8
      const top =
        below + barHeight <= window.innerHeight
          ? below
          : rect.top - barHeight - 8 >= 0
            ? rect.top - barHeight - 8
            : window.innerHeight - barHeight - 16
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - bar.offsetWidth - 8),
      )
      Object.assign(bar.style, { left: `${left}px`, top: `${top}px` })
    } else {
      bar.style.display = 'none'
    }
  }

  const pick = (element: Element | null) => {
    if (!element || element === host || element === document.documentElement) return
    current = element
  }

  const onMove = (event: MouseEvent) => {
    if (locked || inPicker(event)) return
    trail = []
    pick(document.elementFromPoint(event.clientX, event.clientY))
  }

  /** 选择期间拦下网页自己的点击（链接跳转、按钮等），选择器自己的按钮放行 */
  const swallow = (event: Event) => {
    if (inPicker(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  const onClick = (event: MouseEvent) => {
    if (inPicker(event)) return
    swallow(event)
    if (!locked && current) {
      locked = true
      box.classList.add('locked')
      hint.style.display = 'none'
    }
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      swallow(event)
      if (locked) unlock()
      else cleanup()
      return
    }
    if (!current) return
    if (event.key === 'ArrowUp') {
      swallow(event)
      const parent = current.parentElement
      if (parent && parent !== document.documentElement) {
        trail.push(current)
        current = parent
      }
    } else if (event.key === 'ArrowDown') {
      swallow(event)
      const child = trail.pop() ?? current.firstElementChild
      if (child) current = child
    }
  }

  const unlock = () => {
    locked = false
    box.classList.remove('locked')
    hint.style.display = ''
  }

  const listeners: Array<[string, EventListener]> = [
    ['mousemove', onMove as EventListener],
    ['click', onClick as EventListener],
    ['mousedown', swallow],
    ['mouseup', swallow],
    ['pointerdown', swallow],
    ['pointerup', swallow],
    ['keydown', onKey as EventListener],
  ]
  for (const [type, listener] of listeners) window.addEventListener(type, listener, true)

  function cleanup() {
    cancelAnimationFrame(frame)
    for (const [type, listener] of listeners) window.removeEventListener(type, listener, true)
    host.remove()
    window.__devgoCapturePicker = false
  }

  const showToast = (text: string) => {
    layer.replaceChildren()
    const toast = document.createElement('div')
    toast.className = 'toast'
    toast.textContent = text
    layer.append(toast)
    host.style.display = ''
    setTimeout(cleanup, 2600)
  }

  const exportAs = async (format: CaptureFormat) => {
    if (!current) return
    const rect = current.getBoundingClientRect()
    const area = {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    }
    // 先停掉高亮与事件拦截、把选择器藏起来，等两帧让画面刷新后再截
    cancelAnimationFrame(frame)
    for (const [type, listener] of listeners) window.removeEventListener(type, listener, true)
    host.style.display = 'none'
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    try {
      const result = await sendRuntimeMessage({ type: 'capture-element', format, rect: area })
      showToast(
        result.ok
          ? t('capture.picker.done', { name: result.fileName ?? '' })
          : t('capture.picker.failed', { error: result.error ?? '' }),
      )
    } catch (error) {
      showToast(
        t('capture.picker.failed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }

  bar.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action
    if (action === 'png' || action === 'pdf') void exportAs(action)
    else if (action === 'repick') unlock()
    else if (action === 'cancel') cleanup()
  })

  render()
}

export default defineUnlistedScript(() => {
  void startPicker()
})
