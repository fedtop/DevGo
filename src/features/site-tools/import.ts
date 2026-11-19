/**
 * 站点工具的导入 / 导出：
 * - 导出单个工具为 JSON 文件（{ devgoSiteTool: 1, ...定义 }），可分享给别人导入；
 * - 导入支持 DevGo 导出的工具（单个或数组），以及 Chrome DevTools Recorder 导出的 JSON 录制。
 */
import { parseSiteToolDraft, type SiteToolDraft, type SiteToolStep } from './types'

export const EXPORT_MARK = 'devgoSiteTool'

export function exportSiteTool(draft: SiteToolDraft): string {
  return JSON.stringify({ [EXPORT_MARK]: 1, ...draft }, null, 2)
}

interface RecorderStep {
  type: string
  url?: string
  selectors?: (string | string[])[]
  value?: string
  key?: string
  title?: string
}

interface RecorderFile {
  title?: string
  steps: RecorderStep[]
}

function isRecorderFile(value: unknown): value is RecorderFile {
  return (
    typeof value === 'object' &&
    value != null &&
    Array.isArray((value as RecorderFile).steps) &&
    (value as RecorderFile).steps.every(
      (step) => typeof step === 'object' && step != null && typeof step.type === 'string',
    )
  )
}

/**
 * Recorder 的选择器是「选择器链」数组：多段表示依次进入 iframe / Shadow DOM。
 * 单段的直接用；多段的只保留最后一段并改用 pierce/（穿透 Shadow DOM）查找，iframe 内的元素暂不支持。
 */
function convertSelectors(raw: RecorderStep['selectors']): string[] {
  const result: string[] = []
  for (const chain of raw ?? []) {
    const parts = Array.isArray(chain) ? chain : [chain]
    if (!parts.length) continue
    const last = parts[parts.length - 1]
    if (parts.length === 1) result.push(last)
    else if (!/^(aria|text|xpath|pierce)\//.test(last)) result.push(`pierce/${last}`)
  }
  return result
}

function target(step: RecorderStep): { selector: string; selectors?: string[] } | null {
  const [selector, ...selectors] = convertSelectors(step.selectors)
  if (!selector) return null
  return { selector, ...(selectors.length ? { selectors } : {}) }
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : ''
  } catch {
    return ''
  }
}

/** Chrome Recorder 录制 → 站点工具定义 */
function fromRecorder(file: RecorderFile): SiteToolDraft | string {
  const steps: SiteToolStep[] = []
  let startUrl = ''
  for (const step of file.steps) {
    switch (step.type) {
      case 'navigate':
        if (step.url) {
          startUrl ||= step.url
          steps.push({ action: 'navigate', url: step.url })
        }
        break
      case 'click':
      case 'doubleClick': {
        const element = target(step)
        if (element)
          steps.push({
            action: 'click',
            ...element,
            ...(step.type === 'doubleClick' ? { double: true } : {}),
          })
        break
      }
      case 'change': {
        const element = target(step)
        if (element) steps.push({ action: 'fill', ...element, value: step.value ?? '' })
        break
      }
      case 'keyDown':
        // 只保留会触发行为的按键；普通字符已经由 change 记录了最终值
        if (step.key && /^(Enter|Escape|Tab|Arrow\w+|Backspace|Delete)$/.test(step.key)) {
          steps.push({ action: 'press', key: step.key })
        }
        break
      case 'waitForElement': {
        const element = target(step)
        if (element) steps.push({ action: 'wait', ...element })
        break
      }
      default:
        // setViewport / scroll / hover / keyUp / waitForExpression / close 等回放时不需要
        break
    }
  }
  if (!steps.length) return '这个录制里没有可以转换的步骤'
  const parsed = parseSiteToolDraft({
    name: `recording_${Date.now().toString(36)}`,
    description: file.title ? `执行录制「${file.title}」` : '执行导入的录制',
    matches: [hostOf(startUrl) || '*'],
    readOnly: false,
    params: [],
    steps,
  })
  return parsed.ok ? parsed.draft : parsed.error
}

/** 解析导入的文件内容，返回工具定义列表或错误 */
export function parseImport(
  text: string,
): { ok: true; drafts: SiteToolDraft[] } | { ok: false; error: string } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' }
  }

  if (isRecorderFile(value) && !('action' in ((value.steps[0] ?? {}) as object))) {
    const result = fromRecorder(value)
    return typeof result === 'string'
      ? { ok: false, error: result }
      : { ok: true, drafts: [result] }
  }

  const items = Array.isArray(value) ? value : [value]
  const drafts: SiteToolDraft[] = []
  for (const [index, item] of items.entries()) {
    const parsed = parseSiteToolDraft(item)
    if (!parsed.ok) {
      return {
        ok: false,
        error: items.length > 1 ? `第 ${index + 1} 个工具：${parsed.error}` : parsed.error,
      }
    }
    drafts.push(parsed.draft)
  }
  return drafts.length ? { ok: true, drafts } : { ok: false, error: '文件里没有工具' }
}
