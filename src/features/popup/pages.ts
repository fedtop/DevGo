/** popup 面板的 Tab 元数据（App 渲染与设置页「默认打开的页」共用） */

import { t, type MessageKey } from '@/utils/i18n'

export interface PopupPage {
  value: string
  label: string
}

const POPUP_PAGE_DEFS: Array<{ value: string; labelKey: MessageKey }> = [
  { value: 'translate', labelKey: 'popup.pages.translate' },
  { value: 'network', labelKey: 'popup.pages.network' },
  { value: 'tools', labelKey: 'popup.pages.tools' },
  { value: 'function', labelKey: 'popup.pages.function' },
]

/** 带当前语言标签的 Tab 列表（运行时调用，不要在模块顶层求值） */
export function getPopupPages(): PopupPage[] {
  return POPUP_PAGE_DEFS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))
}

export const POPUP_PAGE_VALUES = new Set(POPUP_PAGE_DEFS.map((p) => p.value))
