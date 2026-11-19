/**
 * 侧边栏里的站点工具：把匹配当前网址的站点工具交给模型，
 * 以及 AI 生成站点工具用的三个内置工具（查看网页结构 / 试运行 / 保存）。
 */
import { useEffect, useState } from 'react'

import {
  describeSiteTool,
  normalizeSiteTools,
  parseSiteToolDraft,
  SITE_TOOL_FORMAT,
  siteToolMatches,
  type SiteTool,
  type SiteToolDraft,
} from '@/features/site-tools/types'
import { sendToAssistant } from '@/utils/assistant-bridge'
import { t } from '@/utils/i18n'
import { sendRuntimeMessage, type TabMessage, type WebmcpExecuteResult } from '@/utils/messaging'
import { siteTools } from '@/utils/settings'

import { BUILTIN_FRAME_ID } from './page-tools'
import type { FrameTool } from './webmcp-client'

/** 站点工具没有所属 frame（在顶层 frame 执行），用 -2 与网页工具、内置工具区分 */
export const SITE_TOOL_FRAME_ID = -2

export function isSiteTool(tool: FrameTool): boolean {
  return tool.frameId === SITE_TOOL_FRAME_ID
}

/** 当前网址匹配的、已启用的站点工具 */
export function useSiteTools(url: string): { tools: FrameTool[]; all: SiteTool[] } {
  const [all, setAll] = useState<SiteTool[]>([])

  useEffect(() => {
    void siteTools.getValue().then((value) => setAll(normalizeSiteTools(value)))
    return siteTools.watch((value) => setAll(normalizeSiteTools(value)))
  }, [])

  const tools = all
    .filter((tool) => siteToolMatches(tool, url))
    .map((tool) => ({
      ...describeSiteTool(tool),
      frameId: SITE_TOOL_FRAME_ID,
      siteToolId: tool.id,
    }))
  return { tools, all }
}

async function sendToTop<T>(tabId: number, message: TabMessage): Promise<T | undefined> {
  return sendToAssistant<T | undefined>(tabId, message)
}

function toResult(error: unknown): WebmcpExecuteResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    error: /Receiving end does not exist/i.test(message)
      ? t('assistant.errors.scriptNotReady')
      : message,
  }
}

/** 在网页里按步骤执行一个站点工具（已保存的或 AI 正在试运行的草稿）；由后台编排，支持跨页面 */
export async function runSiteToolInTab(
  tabId: number,
  tool: Pick<SiteToolDraft, 'steps'>,
  args: unknown,
): Promise<WebmcpExecuteResult> {
  try {
    return await sendRuntimeMessage({ type: 'site-tool-run', tabId, steps: tool.steps, args })
  } catch (error) {
    return toResult(error)
  }
}

export async function executeSiteTool(
  tabId: number,
  tool: FrameTool,
  args: unknown,
): Promise<WebmcpExecuteResult> {
  const saved = normalizeSiteTools(await siteTools.getValue()).find(
    (item) => item.id === tool.siteToolId,
  )
  if (!saved) return { ok: false, error: t('assistant.errors.toolMissing', { name: tool.name }) }
  return runSiteToolInTab(tabId, saved, args)
}

/* ---------------------------- AI 生成站点工具 ---------------------------- */

const builtin = (
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  readOnly: boolean,
): FrameTool => ({
  name,
  description,
  inputSchema,
  readOnly,
  annotations: [],
  frameId: BUILTIN_FRAME_ID,
})

const DEFINITION_SCHEMA = {
  type: 'object',
  description: '站点工具定义，格式见 save_site_tool 的说明',
}

export const INSPECT_PAGE_TOOL = builtin(
  'inspect_page',
  '查看当前网页的结构：可交互元素（输入框、按钮、链接）及其 CSS 选择器、重复出现的列表。' +
    '只在用户要求创建或修复「站点工具」时使用；回答网页内容相关的问题用 read_page。',
  { type: 'object', properties: {} },
  true,
)

export const TEST_SITE_TOOL = builtin(
  'test_site_tool',
  '在当前网页上试运行一个站点工具定义（不保存），返回执行结果或出错的步骤。保存前先用它验证定义能正常工作。',
  {
    type: 'object',
    properties: {
      tool: DEFINITION_SCHEMA,
      args: { type: 'object', description: '试运行时传给工具的参数' },
    },
    required: ['tool'],
  },
  // 实际是否需要确认取决于草稿是否只读，见 needsConfirmation
  true,
)

export const SAVE_SITE_TOOL = builtin(
  'save_site_tool',
  '把站点工具保存到 DevGo，之后在匹配的网站上，助手可以直接调用它。' +
    '用户明确要求创建或修改站点工具、且已试运行通过后才调用；保存前用户会看到定义并确认。' +
    '同名工具会被覆盖（用于修复）。\n\n' +
    SITE_TOOL_FORMAT,
  { type: 'object', properties: { tool: DEFINITION_SCHEMA }, required: ['tool'] },
  false,
)

export const AUTHORING_TOOLS = [INSPECT_PAGE_TOOL, TEST_SITE_TOOL, SAVE_SITE_TOOL]

function draftFromArgs(args: unknown): ReturnType<typeof parseSiteToolDraft> {
  const raw = (args as { tool?: unknown } | null)?.tool
  // 部分模型会把对象参数再序列化成字符串
  if (typeof raw === 'string') {
    try {
      return parseSiteToolDraft(JSON.parse(raw))
    } catch {
      return { ok: false, error: 'tool 不是合法的 JSON' }
    }
  }
  return parseSiteToolDraft(raw)
}

/**
 * 执行前是否要用户确认：保存工具总是确认（用户必须看过定义）；
 * 试运行只读草稿、只读工具不确认；其他工具按「执行网页工具前确认」设置。
 */
export function needsConfirmation(tool: FrameTool, args: unknown, confirmTools: boolean): boolean {
  if (tool.name === SAVE_SITE_TOOL.name && tool.frameId === BUILTIN_FRAME_ID) return true
  if (tool.name === TEST_SITE_TOOL.name && tool.frameId === BUILTIN_FRAME_ID) {
    const parsed = draftFromArgs(args)
    return confirmTools && !(parsed.ok && parsed.draft.readOnly)
  }
  return confirmTools && !tool.readOnly
}

/** 保存工具定义；同名工具覆盖（修复 / 重新录制） */
export async function saveDraft(draft: SiteToolDraft): Promise<string> {
  const current = normalizeSiteTools(await siteTools.getValue())
  const existing = current.find((item) => item.name === draft.name)
  const tool: SiteTool = {
    ...draft,
    id: existing?.id ?? crypto.randomUUID(),
    enabled: true,
    updatedAt: Date.now(),
  }
  await siteTools.setValue(
    existing ? current.map((item) => (item.id === existing.id ? tool : item)) : [...current, tool],
  )
  return existing
    ? `已更新站点工具 ${draft.name}，在 ${draft.matches.join('、')} 上可用`
    : `已保存站点工具 ${draft.name}，在 ${draft.matches.join('、')} 上可用`
}

/** 执行 AI 生成站点工具用的内置工具；不是这类工具时返回 null */
export async function executeAuthoringTool(
  tabId: number,
  tool: FrameTool,
  args: unknown,
): Promise<WebmcpExecuteResult | null> {
  if (tool.frameId !== BUILTIN_FRAME_ID) return null
  try {
    switch (tool.name) {
      case INSPECT_PAGE_TOOL.name: {
        const outline = await sendToTop<string>(tabId, { type: 'inspect-page' })
        return outline
          ? { ok: true, result: outline }
          : { ok: false, error: t('assistant.errors.readPageFailed') }
      }
      case TEST_SITE_TOOL.name: {
        const parsed = draftFromArgs(args)
        if (!parsed.ok) return { ok: false, error: `定义有误：${parsed.error}` }
        return runSiteToolInTab(tabId, parsed.draft, (args as { args?: unknown }).args ?? {})
      }
      case SAVE_SITE_TOOL.name: {
        const parsed = draftFromArgs(args)
        if (!parsed.ok) return { ok: false, error: `定义有误：${parsed.error}` }
        return { ok: true, result: await saveDraft(parsed.draft) }
      }
      default:
        return null
    }
  } catch (error) {
    return toResult(error)
  }
}
