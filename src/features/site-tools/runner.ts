/**
 * 站点工具执行器（内容脚本侧）：执行单个步骤。
 * 整个工具由后台按步骤编排（src/background/site-tools.ts），页面跳转后在新页面里接着执行，
 * 所以这里每次只处理一步。只解释固定的几种动作，不执行任何用户代码。
 */
import { fillTemplate, type SiteToolStep } from './types'
import { isVisible, locate, queryAllBySelector } from './locate'

const DEFAULT_TIMEOUT = 10_000
const MAX_WAIT_MS = 60_000
const DEFAULT_READ_LIMIT = 50
const MAX_TEXT_CHARS = 20_000

type Args = Record<string, unknown>

export type StepResult = { ok: true; value?: unknown } | { ok: false; error: string }

class StepError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

/** 「选择器@属性」拆成选择器与属性名 */
function splitSelector(raw: string): { selector: string; attribute?: string } {
  const match = /^(.*\S)@([a-zA-Z_:][\w:.-]*)$/.exec(raw.trim())
  return match ? { selector: match[1], attribute: match[2] } : { selector: raw.trim() }
}

function candidatesOf(step: { selector?: string; selectors?: string[] }, args: Args): string[] {
  return [step.selector, ...(step.selectors ?? [])]
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => fillTemplate(item, args))
}

/** 等目标元素出现（可见且可用）；超时报错并写明尝试过的选择器 */
async function waitForTarget(candidates: string[], timeout = DEFAULT_TIMEOUT): Promise<Element> {
  const deadline = Date.now() + Math.min(timeout, MAX_WAIT_MS)
  for (;;) {
    const element = locate(candidates)
    const ready =
      element &&
      isVisible(element) &&
      !(element instanceof HTMLButtonElement && element.disabled) &&
      !(element instanceof HTMLInputElement && element.disabled)
    if (element && (ready || Date.now() > deadline)) return element
    if (Date.now() > deadline) {
      throw new StepError(
        `没有找到元素：${candidates.join(' 或 ')}（网页可能改版了，或者还没加载出来）`,
      )
    }
    await sleep(100)
  }
}

function textOf(element: Element): string {
  const text = element instanceof HTMLElement ? element.innerText : element.textContent
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** 读取文字或属性；href / src 转成完整地址 */
function readValue(element: Element, attribute?: string): string {
  if (!attribute) {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      return element.value
    }
    return textOf(element)
  }
  const value = element.getAttribute(attribute) ?? ''
  if ((attribute === 'href' || attribute === 'src') && value) {
    try {
      return new URL(value, location.href).href
    } catch {
      return value
    }
  }
  return value
}

function pointerAt(element: Element) {
  const rect = element.getBoundingClientRect()
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
  }
}

/** 模拟一次真实点击：依次派发指针 / 鼠标事件（下拉菜单等组件常监听 mousedown） */
function click(element: Element, double = false) {
  element.scrollIntoView({ block: 'center', inline: 'center' })
  const init = pointerAt(element)
  const times = double ? 2 : 1
  for (let index = 0; index < times; index += 1) {
    element.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }))
    element.dispatchEvent(new MouseEvent('mousedown', { ...init, detail: index + 1 }))
    if (element instanceof HTMLElement) element.focus({ preventScroll: true })
    element.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }))
    element.dispatchEvent(new MouseEvent('mouseup', { ...init, detail: index + 1 }))
    if (element instanceof HTMLElement) element.click()
    else element.dispatchEvent(new MouseEvent('click', { ...init, detail: index + 1 }))
  }
  if (double) element.dispatchEvent(new MouseEvent('dblclick', { ...init, detail: 2 }))
}

/** 给受控输入框赋值：走原型上的 setter，React 等框架才能感知到变化 */
function fill(element: Element, value: string) {
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: 'center', inline: 'center' })
    element.focus({ preventScroll: true })
  }
  if (element instanceof HTMLSelectElement) {
    const option = [...element.options].find(
      (item) => item.value === value || item.text.trim() === value,
    )
    element.value = option?.value ?? value
  } else if (
    element instanceof HTMLInputElement &&
    (element.type === 'checkbox' || element.type === 'radio')
  ) {
    const checked = value === 'true' || value === 'on' || value === '1'
    if (element.checked !== checked) element.click()
    return
  } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const proto =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value)
  } else if (element instanceof HTMLElement && element.isContentEditable) {
    // 富文本编辑器通常监听 beforeinput / input：用 insertText 走浏览器原生的编辑流程
    const selection = window.getSelection()
    selection?.selectAllChildren(element)
    if (!document.execCommand('insertText', false, value)) element.textContent = value
    return
  } else {
    throw new StepError('fill 的目标不是输入框')
  }
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function press(element: Element, key: string) {
  if (element instanceof HTMLElement) element.focus({ preventScroll: true })
  const init: KeyboardEventInit = {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    composed: true,
  }
  const notCanceled = element.dispatchEvent(new KeyboardEvent('keydown', init))
  if (key.length === 1 || key === 'Enter') {
    element.dispatchEvent(new KeyboardEvent('keypress', init))
  }
  element.dispatchEvent(new KeyboardEvent('keyup', init))
  // 合成的键盘事件不会触发浏览器默认的表单提交，这里补上
  if (key === 'Enter' && notCanceled && !(element instanceof HTMLTextAreaElement)) {
    const form = element.closest('form')
    if (form) form.requestSubmit()
  }
}

async function read(step: Extract<SiteToolStep, { action: 'read' }>, args: Args): Promise<unknown> {
  const limit = step.limit ?? DEFAULT_READ_LIMIT
  const raw = candidatesOf(step, args).map(splitSelector)
  const attribute = raw[0]?.attribute
  const candidates = raw.map((item) => item.selector)
  // 先等至少一个元素出现（列表可能是异步加载的）
  const first = await waitForTarget(candidates, step.timeout)

  if (!step.fields && !step.all) return readValue(first, attribute)

  const all =
    candidates.map((selector) => queryAllBySelector(selector)).find((list) => list.length) ?? []
  if (!step.fields) return all.slice(0, limit).map((element) => readValue(element, attribute))

  const fields = Object.entries(step.fields).map(([key, sub]) => [key, splitSelector(sub)] as const)
  return all.slice(0, limit).map((element) =>
    Object.fromEntries(
      fields.map(([key, sub]) => {
        // 子选择器写「@href」时读元素自身的属性
        const target = sub.selector ? element.querySelector(sub.selector) : element
        return [key, target ? readValue(target, sub.attribute) : null]
      }),
    ),
  )
}

async function request(
  step: Extract<SiteToolStep, { action: 'fetch' }>,
  args: Args,
): Promise<unknown> {
  const url = new URL(fillTemplate(step.url, args, 'url'), location.href)
  const method = step.method ?? (step.body ? 'POST' : 'GET')
  const headers: Record<string, string> = Object.fromEntries(
    Object.entries(step.headers ?? {}).map(([key, value]) => [key, fillTemplate(value, args)]),
  )
  let body: string | undefined
  if (step.body != null) {
    const looksJson = /^\s*[[{]/.test(step.body)
    body = fillTemplate(step.body, args, looksJson ? 'json' : 'raw')
    if (looksJson && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
    credentials: url.origin === location.origin ? 'include' : 'same-origin',
  })
  const text = await response.text()
  if (!response.ok) {
    throw new StepError(`接口返回 ${response.status}：${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text
  }
}

/** 执行一步；read / fetch 的结果放在 value 里 */
export async function runStep(step: SiteToolStep, rawArgs: unknown): Promise<StepResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Args
  try {
    switch (step.action) {
      case 'wait':
        if (step.selector)
          await waitForTarget(candidatesOf(step, args), step.timeout ?? DEFAULT_TIMEOUT)
        else await sleep(Math.min(step.ms ?? 0, MAX_WAIT_MS))
        return { ok: true }
      case 'click':
        click(await waitForTarget(candidatesOf(step, args), step.timeout), step.double)
        return { ok: true }
      case 'fill':
        fill(
          await waitForTarget(candidatesOf(step, args), step.timeout),
          fillTemplate(step.value, args),
        )
        return { ok: true }
      case 'press': {
        const target = step.selector
          ? await waitForTarget(candidatesOf(step, args), step.timeout)
          : (document.activeElement ?? document.body)
        press(target, step.key)
        return { ok: true }
      }
      case 'read':
        return { ok: true, value: await read(step, args) }
      case 'fetch':
        return { ok: true, value: await request(step, args) }
      case 'navigate':
        // 跳转由后台用 tabs.update 完成，这里只在单独测试时兜底
        location.assign(new URL(fillTemplate(step.url, args, 'url'), location.href).href)
        return { ok: true }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
