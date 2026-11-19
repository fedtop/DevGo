/**
 * 站点工具执行器：在网页（内容脚本）里按步骤执行工具定义。
 * 只解释固定的几种动作，不执行任何用户代码。
 */
import type { WebmcpExecuteResult } from '@/utils/messaging'

import type { SiteToolStep } from './types'

const DEFAULT_WAIT_TIMEOUT = 5000
const MAX_WAIT_MS = 30_000
const DEFAULT_READ_LIMIT = 50
const MAX_TEXT_CHARS = 20_000

type Args = Record<string, unknown>

class StepError extends Error {}

/** 替换 {{参数名}}；encode 为 URL 时按 URL 编码，json 时按 JSON 字符串转义 */
function fill(template: string, args: Args, mode: 'raw' | 'url' | 'json' = 'raw'): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = args[key]
    const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
    if (mode === 'url') return encodeURIComponent(text)
    if (mode === 'json') return JSON.stringify(text).slice(1, -1)
    return text
  })
}

/** 「选择器@属性」拆成选择器与属性名 */
function splitSelector(raw: string): { selector: string; attribute?: string } {
  const match = /^(.*\S)@([a-zA-Z_:][\w:.-]*)$/.exec(raw.trim())
  return match ? { selector: match[1], attribute: match[2] } : { selector: raw.trim() }
}

function query(selector: string, root: ParentNode = document): Element | null {
  try {
    return root.querySelector(selector)
  } catch {
    throw new StepError(`选择器不合法：${selector}`)
  }
}

function queryAll(selector: string, root: ParentNode = document): Element[] {
  try {
    return [...root.querySelectorAll(selector)]
  } catch {
    throw new StepError(`选择器不合法：${selector}`)
  }
}

function mustFind(selector: string): Element {
  const element = query(selector)
  if (!element) throw new StepError(`没有找到元素：${selector}（网页可能改版了）`)
  return element
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function waitFor(selector: string, timeout: number): Promise<Element> {
  const deadline = Date.now() + Math.min(timeout, MAX_WAIT_MS)
  for (;;) {
    const element = query(selector)
    if (element) return element
    if (Date.now() > deadline) {
      throw new StepError(`等待超时，没有出现：${selector}`)
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
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
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

/** 给受控输入框赋值：走原型上的 setter，React 等框架才能感知到变化 */
function setInputValue(element: Element, value: string) {
  if (element instanceof HTMLSelectElement) {
    const option = [...element.options].find(
      (item) => item.value === value || item.text.trim() === value,
    )
    element.value = option?.value ?? value
  } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const proto =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value)
  } else if (element instanceof HTMLElement && element.isContentEditable) {
    element.focus()
    element.textContent = value
  } else {
    throw new StepError('fill 的目标不是输入框')
  }
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function press(element: Element, key: string) {
  if (element instanceof HTMLElement) element.focus()
  const init: KeyboardEventInit = { key, code: key, bubbles: true, cancelable: true }
  const notCanceled = element.dispatchEvent(new KeyboardEvent('keydown', init))
  element.dispatchEvent(new KeyboardEvent('keypress', init))
  element.dispatchEvent(new KeyboardEvent('keyup', init))
  // 合成的键盘事件不会触发浏览器默认的表单提交，这里补上
  if (key === 'Enter' && notCanceled) {
    const form = element.closest('form')
    if (form) form.requestSubmit()
  }
}

function read(step: Extract<SiteToolStep, { action: 'read' }>): unknown {
  const { selector, attribute } = splitSelector(step.selector)
  const limit = step.limit ?? DEFAULT_READ_LIMIT
  if (step.fields) {
    const fields = Object.entries(step.fields).map(
      ([key, sub]) => [key, splitSelector(sub)] as const,
    )
    return queryAll(selector)
      .slice(0, limit)
      .map((element) =>
        Object.fromEntries(
          fields.map(([key, sub]) => {
            // 子选择器写「@href」时读元素自身的属性
            const target = sub.selector ? query(sub.selector, element) : element
            return [key, target ? readValue(target, sub.attribute) : null]
          }),
        ),
      )
  }
  if (step.all) {
    return queryAll(selector)
      .slice(0, limit)
      .map((element) => readValue(element, attribute))
  }
  return readValue(mustFind(selector), attribute)
}

async function request(
  step: Extract<SiteToolStep, { action: 'fetch' }>,
  args: Args,
): Promise<unknown> {
  const url = new URL(fill(step.url, args, 'url'), location.href)
  const method = step.method ?? (step.body ? 'POST' : 'GET')
  const headers: Record<string, string> = Object.fromEntries(
    Object.entries(step.headers ?? {}).map(([key, value]) => [key, fill(value, args)]),
  )
  let body: string | undefined
  if (step.body != null) {
    const looksJson = /^\s*[[{]/.test(step.body)
    body = fill(step.body, args, looksJson ? 'json' : 'raw')
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

/**
 * 依次执行步骤，read / fetch 的结果按 as（默认 step序号）汇总。
 * 只有一个结果时直接返回它，没有结果时返回「已完成」。
 */
export async function runSiteTool(
  steps: SiteToolStep[],
  rawArgs: unknown,
): Promise<WebmcpExecuteResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Args
  const outputs: Record<string, unknown> = {}

  for (const [index, step] of steps.entries()) {
    try {
      switch (step.action) {
        case 'wait':
          if (step.selector) {
            await waitFor(fill(step.selector, args), step.timeout ?? DEFAULT_WAIT_TIMEOUT)
          } else {
            await sleep(Math.min(step.ms ?? 0, MAX_WAIT_MS))
          }
          break
        case 'click': {
          const element = mustFind(fill(step.selector, args))
          if (element instanceof HTMLElement) element.click()
          else element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          break
        }
        case 'fill':
          setInputValue(mustFind(fill(step.selector, args)), fill(step.value, args))
          break
        case 'press':
          press(mustFind(fill(step.selector, args)), step.key)
          break
        case 'read':
          outputs[step.as || `step${index + 1}`] = read({
            ...step,
            selector: fill(step.selector, args),
          })
          break
        case 'fetch':
          outputs[step.as || `step${index + 1}`] = await request(step, args)
          break
        case 'navigate': {
          const url = new URL(fill(step.url, args, 'url'), location.href).href
          // 先把结果回给侧边栏，再跳转（跳转后消息通道会关闭）
          window.setTimeout(() => location.assign(url), 50)
          outputs.navigatedTo = url
          break
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `第 ${index + 1} 步（${step.action}）失败：${message}` }
    }
  }

  const values = Object.values(outputs)
  const result = values.length === 0 ? '已完成' : values.length === 1 ? values[0] : outputs
  return { ok: true, result: typeof result === 'string' ? result : JSON.stringify(result) }
}
