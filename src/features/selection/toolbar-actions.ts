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
import { t, type MessageKey } from '@/utils/i18n'
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

/** 自定义动作可选的图标（labelKey 为图标说明的文案 key，渲染时再 t()） */
export const ACTION_ICONS: Record<string, { icon: LucideIcon; labelKey: MessageKey }> = {
  sparkles: { icon: Sparkles, labelKey: 'selection.icons.sparkles' },
  languages: { icon: Languages, labelKey: 'selection.icons.languages' },
  bug: { icon: Bug, labelKey: 'selection.icons.bug' },
  braces: { icon: Braces, labelKey: 'selection.icons.braces' },
  code: { icon: Code, labelKey: 'selection.icons.code' },
  lightbulb: { icon: Lightbulb, labelKey: 'selection.icons.lightbulb' },
  'pen-line': { icon: PenLine, labelKey: 'selection.icons.penLine' },
  'list-checks': { icon: ListChecks, labelKey: 'selection.icons.listChecks' },
  'file-text': { icon: FileText, labelKey: 'selection.icons.fileText' },
  search: { icon: Search, labelKey: 'selection.icons.search' },
  'message-circle-question': {
    icon: MessageCircleQuestion,
    labelKey: 'selection.icons.messageCircleQuestion',
  },
  'wand-sparkles': { icon: WandSparkles, labelKey: 'selection.icons.wandSparkles' },
}

export const DEFAULT_ACTION_ICON = 'sparkles'

export function actionIcon(key: string): LucideIcon {
  return (ACTION_ICONS[key] ?? ACTION_ICONS[DEFAULT_ACTION_ICON]).icon
}

export const SELECTION_ACTION_SCOPES: SelectionActionScope[] = ['page', 'input', 'both']

const SCOPE_LABEL_KEYS: Record<SelectionActionScope, MessageKey> = {
  page: 'selection.scope.page',
  input: 'selection.scope.input',
  both: 'selection.scope.both',
}

export function scopeLabel(scope: SelectionActionScope): string {
  return t(SCOPE_LABEL_KEYS[scope])
}

/** 内置动作：网页文字上是翻译 + 阅读类，输入框里是写作类（按当前界面语言生成文案） */
export function getBuiltinActions(): Array<ToolbarAction & { scope: 'page' | 'input' }> {
  return [
    {
      id: 'translate',
      label: t('selection.toolbar.translate'),
      title: t('selection.toolbar.translateTitle'),
      icon: Languages,
      write: false,
      scope: 'page',
    },
    ...READ_ACTIONS.map((id) => ({
      id,
      label: t(SELECTION_AI_ACTIONS[id].labelKey),
      title: t(SELECTION_AI_ACTIONS[id].titleKey),
      icon: id === 'explain' ? BookOpen : ListChecks,
      write: false,
      scope: 'page' as const,
    })),
    ...WRITE_ACTIONS.map((id) => ({
      id,
      label: t(SELECTION_AI_ACTIONS[id].labelKey),
      title: t(SELECTION_AI_ACTIONS[id].titleKey),
      icon: { polish: WandSparkles, fix: SpellCheck, formal: Briefcase }[id],
      write: true,
      scope: 'input' as const,
    })),
  ]
}

/** 工具条上直接显示的按钮数（不含「问 AI」「更多」），其余收进「更多」 */
export const MAX_TOOLBAR_ACTIONS = 4

/**
 * 「从示例添加」的模板：添加时按当前界面语言生成名称与提示词，写入存储后即为用户数据，不再随语言变化。
 */
export function getSelectionActionTemplates(): Array<Omit<SelectionCustomAction, 'id'>> {
  return [
    {
      name: t('selection.templates.translateToEnglish.name'),
      icon: 'languages',
      scope: 'both',
      prompt: t('selection.templates.translateToEnglish.prompt'),
    },
    {
      name: t('selection.templates.explainError.name'),
      icon: 'bug',
      scope: 'page',
      prompt: t('selection.templates.explainError.prompt'),
    },
    {
      name: t('selection.templates.toJson.name'),
      icon: 'braces',
      scope: 'both',
      prompt: t('selection.templates.toJson.prompt'),
    },
  ]
}

/** 备份导入等来源的数据可能不完整：只保留字段齐全的动作 */
export function normalizeCustomActions(value: unknown): SelectionCustomAction[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is SelectionCustomAction =>
      !!item &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.prompt === 'string' &&
      SELECTION_ACTION_SCOPES.includes(item.scope),
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
  const builtinActions = getBuiltinActions()
  if (!aiAvailable) return editable ? [] : [builtinActions[0]]
  const builtins = builtinActions.filter(
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
