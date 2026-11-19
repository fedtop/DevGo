/**
 * 站点工具：用户（或 AI）按网站定义的工具，侧边栏助手可以像 WebMCP 工具一样调用。
 *
 * 工具定义是纯数据：一组参数 + 一串固定步骤（点击、填写、读取、请求接口…），
 * 由扩展内置的执行器（runner.ts）在网页里逐步执行，不运行任何用户代码，
 * 所以不需要额外权限，也不受网页 CSP 限制。
 */
import type { WebmcpTool } from '@/utils/messaging'

export interface SiteToolParam {
  name: string
  description: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
}

/**
 * 执行步骤。selector 是 CSS 选择器，可用「选择器@属性」读取属性（如 a.title@href）；
 * 文本类字段里的 {{参数名}} 会替换成调用时的参数值。
 */
export type SiteToolStep =
  /** 等待元素出现（最多 timeout 毫秒），或不给 selector 时单纯等待 ms 毫秒 */
  | { action: 'wait'; selector?: string; ms?: number; timeout?: number }
  | { action: 'click'; selector: string }
  /** 填写输入框 / 文本域 / 下拉框（兼容 React 等框架的受控输入） */
  | { action: 'fill'; selector: string; value: string }
  /** 在元素上按键；Enter 会同时提交所在的表单 */
  | { action: 'press'; selector: string; key: string }
  /**
   * 读取元素：默认取第一个匹配元素的文字；all 读全部；
   * fields 时对每个匹配元素按子选择器取字段，得到对象列表（适合搜索结果、列表）
   */
  | {
      action: 'read'
      selector: string
      all?: boolean
      fields?: Record<string, string>
      limit?: number
      as?: string
    }
  /** 以当前登录状态请求网站接口（同站请求会带上 Cookie），返回 JSON 或文本 */
  | {
      action: 'fetch'
      url: string
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      body?: string
      headers?: Record<string, string>
      as?: string
    }
  /** 跳转到新地址（只能作为最后一步） */
  | { action: 'navigate'; url: string }

export type SiteToolAction = SiteToolStep['action']

export interface SiteTool {
  id: string
  /** 工具名：字母、数字、下划线，模型据此调用 */
  name: string
  /** 告诉模型这个工具做什么、什么时候用 */
  description: string
  /** 生效的网址：域名（github.com、*.github.com）或带路径的通配（github.com/*\/issues*） */
  matches: string[]
  /** 只读工具（只读取、不修改数据）执行前不需要确认 */
  readOnly: boolean
  enabled: boolean
  params: SiteToolParam[]
  steps: SiteToolStep[]
  updatedAt: number
}

/** 工具定义里由用户 / AI 填写的部分 */
export type SiteToolDraft = Omit<SiteTool, 'id' | 'enabled' | 'updatedAt'>

const ACTIONS: SiteToolAction[] = ['wait', 'click', 'fill', 'press', 'read', 'fetch', 'navigate']
const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/
const MAX_STEPS = 30

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value)

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string')

function checkStep(step: unknown, index: number, isLast: boolean): string | null {
  const at = `steps[${index}]`
  if (!isRecord(step)) return `${at} 必须是对象`
  const action = step.action as SiteToolAction
  if (!ACTIONS.includes(action)) return `${at}.action 只能是 ${ACTIONS.join(' / ')}`
  const needString = (key: string) =>
    typeof step[key] === 'string' && (step[key] as string).trim()
      ? null
      : `${at}（${action}）缺少 ${key}`

  switch (action) {
    case 'wait':
      if (step.selector == null && typeof step.ms !== 'number') {
        return `${at}（wait）需要 selector 或 ms`
      }
      return null
    case 'click':
      return needString('selector')
    case 'fill':
      return needString('selector') ?? (typeof step.value === 'string' ? null : `${at} 缺少 value`)
    case 'press':
      return needString('selector') ?? needString('key')
    case 'read':
      if (step.fields != null && !isStringRecord(step.fields)) {
        return `${at}.fields 必须是「字段名: 子选择器」的对象`
      }
      return needString('selector')
    case 'fetch':
      if (step.headers != null && !isStringRecord(step.headers)) {
        return `${at}.headers 必须是字符串对象`
      }
      return needString('url')
    case 'navigate':
      return needString('url') ?? (isLast ? null : `${at}：navigate 只能是最后一步`)
  }
}

/**
 * 校验并规范化工具定义（来自设置页 JSON 编辑或 AI 生成）。
 * 返回的错误信息会直接交给模型修正，所以写得具体。
 */
export function parseSiteToolDraft(
  value: unknown,
): { ok: true; draft: SiteToolDraft } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: '工具定义必须是 JSON 对象' }
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, error: 'name 必须以字母开头，只含字母、数字、下划线，最长 48 个字符' }
  }
  const description = typeof value.description === 'string' ? value.description.trim() : ''
  if (!description) return { ok: false, error: '缺少 description（说明工具做什么、何时使用）' }

  const matches = Array.isArray(value.matches)
    ? value.matches.filter((item): item is string => typeof item === 'string' && !!item.trim())
    : []
  if (!matches.length) return { ok: false, error: 'matches 至少要有一个网址规则，如 github.com' }

  const rawParams = value.params ?? []
  if (!Array.isArray(rawParams)) return { ok: false, error: 'params 必须是数组' }
  const params: SiteToolParam[] = []
  for (const [index, param] of rawParams.entries()) {
    if (!isRecord(param) || typeof param.name !== 'string' || !NAME_PATTERN.test(param.name)) {
      return { ok: false, error: `params[${index}].name 不合法` }
    }
    const type = param.type ?? 'string'
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      return { ok: false, error: `params[${index}].type 只能是 string / number / boolean` }
    }
    params.push({
      name: param.name,
      description: typeof param.description === 'string' ? param.description : '',
      type,
      required: param.required !== false,
    })
  }

  if (!Array.isArray(value.steps) || !value.steps.length) {
    return { ok: false, error: 'steps 至少要有一步' }
  }
  if (value.steps.length > MAX_STEPS) return { ok: false, error: `steps 最多 ${MAX_STEPS} 步` }
  for (const [index, step] of value.steps.entries()) {
    const error = checkStep(step, index, index === value.steps.length - 1)
    if (error) return { ok: false, error }
  }

  return {
    ok: true,
    draft: {
      name,
      description,
      matches: matches.map((item) => item.trim()),
      readOnly: value.readOnly === true,
      params,
      steps: value.steps as SiteToolStep[],
    },
  }
}

/** 存储里的工具逐个校验，跳过损坏的（如手改备份文件） */
export function normalizeSiteTools(value: unknown): SiteTool[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const parsed = parseSiteToolDraft(item)
    if (!parsed.ok) return []
    return [
      {
        ...parsed.draft,
        id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
        enabled: item.enabled !== false,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      },
    ]
  })
}

/** 编辑 / 导出时展示的定义（不含 id 等内部字段） */
export function toDraft(tool: SiteTool): SiteToolDraft {
  const { name, description, matches, readOnly, params, steps } = tool
  return { name, description, matches, readOnly, params, steps }
}

function globToRegExp(glob: string): RegExp {
  const source = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${source}$`, 'i')
}

/**
 * 网址规则匹配：
 * - 不含「/」时按域名匹配：github.com 同时匹配其子域名，*.github.com 只匹配子域名；
 * - 含「/」时按「域名 + 路径」通配匹配（* 匹配任意字符），如 github.com/*\/issues*。
 */
export function matchesUrl(pattern: string, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!/^https?:$/.test(parsed.protocol)) return false
  const rule = pattern.trim().replace(/^https?:\/\//, '')
  if (!rule) return false
  // 规则里带端口（localhost:3000）时连端口一起比较
  const hostOf = (domainRule: string) =>
    (domainRule.includes(':') ? parsed.host : parsed.hostname).toLowerCase()

  if (!rule.includes('/')) {
    const domain = rule.toLowerCase()
    const host = hostOf(domain)
    if (domain.startsWith('*.')) return host.endsWith(domain.slice(1))
    return host === domain || host.endsWith(`.${domain}`)
  }
  const host = hostOf(rule.split('/')[0])
  return globToRegExp(rule).test(`${host}${parsed.pathname}${parsed.search}`)
}

export function siteToolMatches(tool: SiteTool, url: string): boolean {
  return tool.enabled && tool.matches.some((pattern) => matchesUrl(pattern, url))
}

/** 参数列表 → 交给模型的 JSON Schema */
export function paramsToSchema(params: SiteToolParam[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      params.map((param) => [param.name, { type: param.type, description: param.description }]),
    ),
    required: params.filter((param) => param.required).map((param) => param.name),
  }
}

/** 按 WebMCP 工具的形状描述站点工具（侧边栏工具列表、模型函数定义共用） */
export function describeSiteTool(tool: SiteToolDraft): WebmcpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: paramsToSchema(tool.params),
    readOnly: tool.readOnly,
    annotations: [],
  }
}

/** 新建工具时的模板 */
export const SITE_TOOL_TEMPLATE: SiteToolDraft = {
  name: 'search_site',
  description: '在本站搜索关键词，返回结果的标题和链接',
  matches: ['example.com'],
  readOnly: true,
  params: [{ name: 'query', description: '搜索关键词', type: 'string', required: true }],
  steps: [{ action: 'fetch', url: 'https://example.com/api/search?q={{query}}', as: 'results' }],
}

/** 交给模型的定义格式说明（AI 生成站点工具时用） */
export const SITE_TOOL_FORMAT = `站点工具定义（JSON 对象）：
- name：工具名，字母开头，只含字母数字下划线；
- description：说明做什么、什么时候用，模型据此决定是否调用；
- matches：生效网址数组，域名（github.com，含子域名；有端口时写上端口，如 localhost:3000）或带路径通配（github.com/*/issues*）；
- readOnly：只读取、不修改任何数据时为 true（执行前不需要用户确认）；
- params：参数数组，每项 { name, description, type: "string"|"number"|"boolean", required }；
- steps：按顺序执行的步骤数组，文本字段中的 {{参数名}} 会替换成参数值（url 里会自动编码）：
  - { "action": "fetch", "url", "method"?, "body"?, "headers"?, "as"? }：以用户当前登录状态请求接口，返回 JSON 或文本。能找到网站自己的接口时优先用它，最稳定；
  - { "action": "fill", "selector", "value" }：填写输入框；
  - { "action": "press", "selector", "key": "Enter" }：按键（Enter 会提交所在表单）；
  - { "action": "click", "selector" }：点击元素；
  - { "action": "wait", "selector"?, "ms"?, "timeout"? }：等待元素出现或等待一段时间；
  - { "action": "read", "selector", "all"?, "fields"?, "limit"?, "as"? }：读取元素文字；「选择器@属性」读属性（如 a@href）；fields 为 { 字段名: 子选择器 } 时对每个匹配元素取字段，得到对象列表；
  - { "action": "navigate", "url" }：跳转网址，只能是最后一步。
- 每个 read / fetch 的结果按 as（默认 step序号）汇总为工具的返回值；只有一个结果时直接返回它。
- 选择器要稳定：优先 id、name、aria-label、data-* 属性，避免依赖随机生成的 class。`
