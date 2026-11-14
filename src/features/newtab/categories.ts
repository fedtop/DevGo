/**
 * 快捷导航分类定义与工具。
 */

import { t, type MessageKey } from '@/utils/i18n'
import type { QuickNavCategoryId, QuickNavCategoryLabels, QuickNavItem } from '@/utils/settings'

export interface QuickNavCategory {
  id: QuickNavCategoryId
  /** 默认名文案 key（渲染时再取当前语言） */
  labelKey: MessageKey
}

export const QUICK_NAV_CATEGORIES: QuickNavCategory[] = [
  { id: 'common', labelKey: 'newtab.category.common' },
  { id: 'dev', labelKey: 'newtab.category.dev' },
  { id: 'ai', labelKey: 'newtab.category.ai' },
  { id: 'community', labelKey: 'newtab.category.community' },
  { id: 'tools', labelKey: 'newtab.category.tools' },
]

export const DEFAULT_CATEGORY: QuickNavCategoryId = 'common'

/** 分类自定义名称的最大长度 */
export const CATEGORY_LABEL_MAX = 12

export function isQuickNavCategory(value: unknown): value is QuickNavCategoryId {
  return QUICK_NAV_CATEGORIES.some((category) => category.id === value)
}

/** 取分类默认名（当前界面语言） */
export function defaultLabelOf(id: QuickNavCategoryId): string {
  return t(QUICK_NAV_CATEGORIES.find((category) => category.id === id)!.labelKey)
}

/** 取分类展示名：优先用户自定义，缺省用默认名 */
export function labelOf(id: QuickNavCategoryId, overrides?: QuickNavCategoryLabels): string {
  return overrides?.[id]?.trim() || defaultLabelOf(id)
}

/** 清洗外部输入（导入 / 备份）的分类名称覆盖：只收已知分类、非空、与默认名不同的字符串 */
export function sanitizeCategoryLabels(input: unknown): QuickNavCategoryLabels {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const result: QuickNavCategoryLabels = {}
  QUICK_NAV_CATEGORIES.forEach(({ id }) => {
    const raw = (input as Record<string, unknown>)[id]
    if (typeof raw !== 'string') return
    const label = raw.trim().slice(0, CATEGORY_LABEL_MAX)
    if (label && label !== defaultLabelOf(id)) result[id] = label
  })
  return result
}

/** 旧数据无 category 字段，统一视为「常用」 */
export function categoryOf(item: QuickNavItem): QuickNavCategoryId {
  return item.category ?? DEFAULT_CATEGORY
}
