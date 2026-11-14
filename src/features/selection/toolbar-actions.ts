/**
 * 划词工具条上的动作列表：内置动作（翻译 + AI 动作）与用户自定义动作合并成统一的条目，
 * 工具条、结果面板和设置页共用。
 */
import {
  customActionKey,
  READ_ACTIONS,
  SELECTION_AI_ACTIONS,
  WRITE_ACTIONS,
  type SelectionActionId,
} from '@/features/ai/actions'
import type { SelectionActionScope, SelectionCustomAction } from '@/utils/settings'
import {
  BookOpen,
  Braces,
  Briefcase,
  Bug,
  Code,
  FileText,
  Languages,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  PenLine,
  Search,
  Sparkles,
  SpellCheck,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'

/** 结果面板的模式：翻译或某个 AI 动作 */
export type SelectionMode = 'translate' | SelectionActionId

export interface ToolbarAction {
  id: SelectionMode
  label: string
  title: string
  icon: LucideIcon
  /** 结果用于替换输入框里的原文（写作类） */
  write: boolean
}

/** 自定义动作可选的图标 */
export const ACTION_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  sparkles: { icon: Sparkles, label: '通用' },
  languages: { icon: Languages, label: '翻译' },
  bug: { icon: Bug, label: '报错' },
  braces: { icon: Braces, label: 'JSON' },
  code: { icon: Code, label: '代码' },
  lightbulb: { icon: Lightbulb, label: '灵感' },
  'pen-line': { icon: PenLine, label: '写作' },
  'list-checks': { icon: ListChecks, label: '要点' },
  'file-text': { icon: FileText, label: '文档' },
  search: { icon: Search, label: '查找' },
  'message-circle-question': { icon: MessageCircleQuestion, label: '提问' },
  'wand-sparkles': { icon: WandSparkles, label: '改写' },
}

export const DEFAULT_ACTION_ICON = 'sparkles'

export function actionIcon(key: string): LucideIcon {
  return (ACTION_ICONS[key] ?? ACTION_ICONS[DEFAULT_ACTION_ICON]).icon
}

export const SCOPE_LABELS: Record<SelectionActionScope, string> = {
  page: '网页文字',
  input: '输入框',
  both: '两者都适用',
}

/** 内置动作：网页文字上是翻译 + 阅读类，输入框里是写作类 */
export const BUILTIN_ACTIONS: Array<ToolbarAction & { scope: 'page' | 'input' }> = [
  {
    id: 'translate',
    label: '翻译',
    title: '翻译选中文本',
    icon: Languages,
    write: false,
    scope: 'page',
  },
  ...READ_ACTIONS.map((id) => ({
    id,
    ...SELECTION_AI_ACTIONS[id],
    icon: id === 'explain' ? BookOpen : ListChecks,
    write: false,
    scope: 'page' as const,
  })),
  ...WRITE_ACTIONS.map((id) => ({
    id,
    ...SELECTION_AI_ACTIONS[id],
    icon: { polish: WandSparkles, fix: SpellCheck, formal: Briefcase }[id],
    write: true,
    scope: 'input' as const,
  })),
]

/** 工具条上直接显示的按钮数（不含「问 AI」「更多」），其余收进「更多」 */
export const MAX_TOOLBAR_ACTIONS = 4

export const SELECTION_ACTION_TEMPLATES: Array<Omit<SelectionCustomAction, 'id'>> = [
  {
    name: '译成英文',
    icon: 'languages',
    scope: 'both',
    prompt: '把选中的内容翻译成地道、自然的英文。保留代码、专有名词和格式；只输出译文，不要解释。',
  },
  {
    name: '解释报错',
    icon: 'bug',
    scope: 'page',
    prompt:
      '选中的是一段程序报错或日志。先用一句话说明出错的原因，再按可能性从高到低列出排查和修复步骤，必要时给出示例代码。',
  },
  {
    name: '转 JSON',
    icon: 'braces',
    scope: 'both',
    prompt:
      '把选中的内容整理成结构清晰的 JSON：根据内容推断合适的字段名（英文小驼峰）和类型。只输出 JSON 本身，不要用代码块包裹，不要解释。',
  },
]

/** 备份导入等来源的数据可能不完整：只保留字段齐全的动作 */
export function normalizeCustomActions(value: unknown): SelectionCustomAction[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is SelectionCustomAction =>
      !!item &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.prompt === 'string' &&
      ['page', 'input', 'both'].includes(item.scope),
  )
}

function appliesTo(scope: SelectionActionScope, editable: boolean): boolean {
  return scope === 'both' || scope === (editable ? 'input' : 'page')
}

/**
 * 当前选区可用的动作（按显示顺序）：内置动作在前、自定义动作在后。
 * AI 不可用时网页文字上只保留翻译（即使被隐藏，否则工具条为空），输入框里没有动作。
 */
export function listToolbarActions({
  editable,
  aiAvailable,
  hidden,
  custom,
}: {
  editable: boolean
  aiAvailable: boolean
  hidden: string[]
  custom: SelectionCustomAction[]
}): ToolbarAction[] {
  if (!aiAvailable) return editable ? [] : [BUILTIN_ACTIONS[0]]
  const builtins = BUILTIN_ACTIONS.filter(
    (action) => appliesTo(action.scope, editable) && !hidden.includes(action.id),
  )
  const customs = custom
    .filter((action) => appliesTo(action.scope, editable))
    .map<ToolbarAction>((action) => ({
      id: customActionKey(action.id),
      label: action.name,
      title: action.prompt,
      icon: actionIcon(action.icon),
      write: editable,
    }))
  return [...builtins, ...customs]
}
