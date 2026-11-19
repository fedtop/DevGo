/**
 * 站点工具录制器：由后台按需注入（侧边栏「录制操作」），页面跳转后后台会重新注入。
 * 把用户的点击、输入、按键翻译成站点工具的步骤发给后台保存；页面顶部显示录制条，
 * 可以「选取数据」把页面上的文字 / 列表记成读取步骤。录制条自身的操作不会被录进去。
 */
import { accessibleName, interactiveTarget, selectorCandidates } from '@/features/site-tools/locate'
import { initI18n, t } from '@/utils/i18n'
import { sendRuntimeMessage, type RecordedStep, type RecorderStatus } from '@/utils/messaging'

const HOST_TAG = 'devgo-site-recorder'
const ACCENT = '#ef4444'
/** 输入停顿这么久后记一次填写（离开输入框、按回车、点击别处时会立即记录） */
const FILL_DEBOUNCE_MS = 600
const NOTE_MAX = 40

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
  padding: 6px 6px 6px 12px; border-radius: 999px; background: rgba(17, 18, 22, 0.92); color: #fff;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25); pointer-events: auto; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: ${ACCENT}; animation: pulse 1.2s ease-in-out infinite; }
.dot.paused { animation: none; background: #f59e0b; }
@keyframes pulse { 50% { opacity: 0.35; } }
.bar button { all: unset; cursor: pointer; padding: 5px 11px; border-radius: 999px; font-size: 12.5px; color: #fff;
  background: rgba(255, 255, 255, 0.1); }
.bar button:hover { background: rgba(255, 255, 255, 0.2); }
.bar button.active { background: #fff; color: #111216; }
.bar button.primary { background: ${ACCENT}; }
.bar button.primary:hover { background: #dc2626; }
.box { position: fixed; display: none; border: 2px solid #1783ff; background: rgba(23, 131, 255, 0.08);
  border-radius: 3px; box-sizing: border-box; }
.choice { position: fixed; display: none; gap: 6px; padding: 6px; border-radius: 10px; background: #fff;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.22); pointer-events: auto; }
.choice button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 7px; font-size: 12.5px; color: #1f2328; }
.choice button:hover { background: #f1f3f5; }
.toast { position: fixed; top: 58px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 8px;
  background: rgba(17, 18, 22, 0.88); color: #fff; font-size: 12px; opacity: 0; transition: opacity 0.2s; }
.toast.show { opacity: 1; }
`

declare global {
  interface Window {
    __devgoSiteRecorder?: boolean
  }
}

const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()
const clip = (text: string) => (text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX)}…` : text)

function noteOf(element: Element): string {
  const name = accessibleName(element)
  if (name) return clip(name)
  const text = element instanceof HTMLElement ? normalize(element.innerText) : ''
  return clip(text || element.tagName.toLowerCase())
}

function target(element: Element) {
  const [selector, ...selectors] = selectorCandidates(element)
  return { selector, ...(selectors.length ? { selectors } : {}), note: noteOf(element) }
}

function isTextField(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLElement && element.isContentEditable) return true
  return (
    element instanceof HTMLInputElement &&
    !/^(checkbox|radio|submit|button|reset|image|file|range|color)$/.test(element.type)
  )
}

/** 重复出现的同构兄弟元素（列表项）：用于「读取整个列表」 */
function listOf(element: Element): { selector: string; count: number } | null {
  for (
    let item: Element | null = element;
    item && item !== document.body;
    item = item.parentElement
  ) {
    const parent = item.parentElement
    if (!parent) break
    const signature = (node: Element) => `${node.tagName}.${[...node.classList].sort().join('.')}`
    const siblings = [...parent.children].filter((child) => signature(child) === signature(item))
    if (siblings.length >= 3) {
      const [parentSelector] = selectorCandidates(parent).filter(
        (s) => !s.startsWith('aria/') && !s.startsWith('text/'),
      )
      if (!parentSelector) return null
      const classes = [...item.classList].map((name) => `.${CSS.escape(name)}`).join('')
      const prefix = parentSelector.startsWith('xpath/') ? null : parentSelector
      if (!prefix) return null
      return {
        selector: `${prefix} > ${item.tagName.toLowerCase()}${classes}`,
        count: siblings.length,
      }
    }
  }
  return null
}

async function startRecorder() {
  if (window.__devgoSiteRecorder) return
  window.__devgoSiteRecorder = true

  let status: RecorderStatus | null = await sendRuntimeMessage({
    type: 'site-recorder-status',
  }).catch(() => null)
  if (!status) {
    window.__devgoSiteRecorder = false
    return
  }
  await initI18n()

  const host = document.createElement(HOST_TAG)
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>${STYLE}</style>
    <div class="layer">
      <div class="box"></div>
      <div class="choice"><button data-action="one"></button><button data-action="list"></button></div>
      <div class="toast"></div>
      <div class="bar">
        <span class="dot"></span><span class="count"></span>
        <button data-action="pick"></button>
        <button data-action="cancel"></button>
        <button class="primary" data-action="finish"></button>
      </div>
    </div>`
  document.documentElement.append(host)

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T
  const count = $('.count')
  const box = $('.box')
  const choice = $('.choice')
  const toast = $('.toast')
  const pickButton = $('[data-action=pick]')
  pickButton.textContent = t('assistant.recorder.pick')
  $('[data-action=cancel]').textContent = t('assistant.recorder.cancel')
  $('[data-action=finish]').textContent = t('assistant.recorder.finish')

  const render = () => {
    count.textContent = t('assistant.recorder.recording', { count: status?.stepCount ?? 0 })
  }
  render()

  let toastTimer = 0
  const showToast = (text: string) => {
    toast.textContent = text
    toast.classList.add('show')
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1600)
  }

  const send = (step: RecordedStep) => {
    void sendRuntimeMessage({ type: 'site-recorder-step', step })
      .then((next) => {
        if (next) status = next
        render()
      })
      .catch(() => undefined)
  }

  /* ---------------------------- 输入：防抖合并 ---------------------------- */

  let pending: { element: Element; timer: number } | null = null

  const fillStep = (element: Element): RecordedStep => {
    const isPassword = element instanceof HTMLInputElement && element.type === 'password'
    const value =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? element.value
        : normalize((element as HTMLElement).innerText)
    if (isPassword && !status?.capturePasswords) {
      return { action: 'fill', ...target(element), value: '{{password}}', password: true }
    }
    return { action: 'fill', ...target(element), value, ...(isPassword ? { password: true } : {}) }
  }

  const flush = () => {
    if (!pending) return
    window.clearTimeout(pending.timer)
    const { element } = pending
    pending = null
    if (element.isConnected) send(fillStep(element))
  }

  const isOwn = (event: Event) => event.composedPath().includes(host)
  const eventTarget = (event: Event) => {
    const [first] = event.composedPath()
    return first instanceof Element ? first : null
  }

  /* -------------------------------- 选取数据 -------------------------------- */

  let picking = false
  let hovered: Element | null = null
  let chosen: Element | null = null

  const setPicking = (next: boolean) => {
    picking = next
    pickButton.classList.toggle('active', next)
    $('.dot').classList.toggle('paused', next)
    box.style.display = 'none'
    choice.style.display = 'none'
    chosen = null
    if (next) showToast(t('assistant.recorder.pickHint'))
  }

  const highlight = (element: Element | null) => {
    if (!element) {
      box.style.display = 'none'
      return
    }
    const rect = element.getBoundingClientRect()
    Object.assign(box.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
  }

  const recordRead = (mode: 'one' | 'list') => {
    if (!chosen) return
    const index = (status?.stepCount ?? 0) + 1
    const list = mode === 'list' ? listOf(chosen) : null
    if (list) {
      send({
        action: 'read',
        selector: list.selector,
        all: true,
        as: `list${index}`,
        note: t('assistant.recorder.listNote', { count: list.count }),
      })
    } else {
      send({ action: 'read', ...target(chosen), as: `text${index}` })
    }
    showToast(t('assistant.recorder.picked'))
    setPicking(false)
  }

  /* -------------------------------- 事件监听 -------------------------------- */

  const onClick = (event: MouseEvent) => {
    if (!event.isTrusted || isOwn(event) || event.button !== 0) return
    const element = eventTarget(event)
    if (!element) return
    if (picking) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      chosen = element
      highlight(element)
      const list = listOf(element)
      const rect = element.getBoundingClientRect()
      $('[data-action=one]').textContent = t('assistant.recorder.readOne')
      const listButton = $('[data-action=list]')
      listButton.style.display = list ? '' : 'none'
      listButton.textContent = list ? t('assistant.recorder.readList', { count: list.count }) : ''
      Object.assign(choice.style, {
        display: 'flex',
        left: `${Math.min(Math.max(8, rect.left), window.innerWidth - 260)}px`,
        top: `${Math.min(rect.bottom + 6, window.innerHeight - 50)}px`,
      })
      return
    }
    const clicked = interactiveTarget(element)
    // 点进输入框只是聚焦，填写会单独记录；label 会把点击转给对应的控件，由控件那次点击记录
    if (isTextField(clicked) || clicked instanceof HTMLSelectElement) return
    if (clicked instanceof HTMLLabelElement && clicked.control) return
    flush()
    send({ action: 'click', ...target(clicked) })
  }

  const onInput = (event: Event) => {
    if (!event.isTrusted || isOwn(event) || picking) return
    const element = eventTarget(event)
    if (!element) return
    const field =
      element instanceof HTMLElement && element.isContentEditable
        ? (element.closest('[contenteditable]:not([contenteditable=false])') ?? element)
        : element
    if (!isTextField(field) && !(field instanceof HTMLSelectElement)) return
    if (field instanceof HTMLSelectElement) {
      flush()
      send(fillStep(field))
      return
    }
    if (pending && pending.element !== field) flush()
    if (pending) window.clearTimeout(pending.timer)
    pending = { element: field, timer: window.setTimeout(flush, FILL_DEBOUNCE_MS) }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.isTrusted || isOwn(event)) return
    if (picking) {
      if (event.key === 'Escape') setPicking(false)
      return
    }
    const isEnter = event.key === 'Enter' && !event.isComposing
    const element = eventTarget(event)
    if (!isEnter && event.key !== 'Escape') return
    // 多行文本里的回车是换行，不是提交
    if (isEnter && element instanceof HTMLTextAreaElement && !event.metaKey && !event.ctrlKey)
      return
    flush()
    const focus = element && element !== document.body ? element : null
    send({ action: 'press', key: event.key, ...(focus ? target(focus) : {}) })
  }

  const onMove = (event: MouseEvent) => {
    if (!picking || chosen || isOwn(event)) return
    hovered = eventTarget(event)
    highlight(hovered)
  }

  const listeners: Array<[string, EventListener]> = [
    ['click', onClick as EventListener],
    ['input', onInput],
    ['change', onInput],
    ['keydown', onKeyDown as EventListener],
    ['mousemove', onMove as EventListener],
    ['blur', flush],
  ]
  for (const [type, listener] of listeners) window.addEventListener(type, listener, true)
  // 离开页面（跳转）前把还没记录的输入记上
  window.addEventListener('pagehide', flush)

  const cleanup = () => {
    for (const [type, listener] of listeners) window.removeEventListener(type, listener, true)
    window.removeEventListener('pagehide', flush)
    host.remove()
    window.__devgoSiteRecorder = false
  }

  root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action
    if (action === 'pick') setPicking(!picking)
    else if (action === 'one' || action === 'list') recordRead(action)
    else if (action === 'finish' || action === 'cancel') {
      flush()
      // 等最后一步写入后台后再结束
      window.setTimeout(() => {
        void sendRuntimeMessage({ type: 'site-recorder-finish', cancel: action === 'cancel' })
          .catch(() => undefined)
          .finally(cleanup)
      }, 80)
    }
  })
}

export default defineUnlistedScript(() => {
  void startRecorder()
})
