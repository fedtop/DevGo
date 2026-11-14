/**
 * 翻译相关设置的界面选项（popup 与选项页共用，保证文案一致）。
 *
 * 选项表在模块顶层定义，label 用 getter 在读取时才取当前界面语言的文案（t() 不能在模块顶层求值）。
 */

import { t, type MessageKey, type MessageParams } from '@/utils/i18n'
import { isMac } from '@/utils/shortcut'
import type { HoverTranslateMode, TranslateDisplayMode, TranslateProvider } from '@/utils/settings'

interface LabeledOption<T> {
  value: T
  label: string
}

function option<T>(value: T, key: MessageKey, params?: MessageParams): LabeledOption<T> {
  return {
    value,
    get label() {
      return t(key, params)
    },
  }
}

const ALT_LABEL = isMac ? '⌥ Option' : 'Alt'
const CTRL_LABEL = isMac ? '⌃ Control' : 'Ctrl'
const SHIFT_LABEL = isMac ? '⇧ Shift' : 'Shift'

export const PROVIDER_OPTIONS: Array<LabeledOption<TranslateProvider>> = [
  option('microsoft', 'translate.provider.microsoft'),
  option('google', 'translate.provider.google'),
  option('llm', 'translate.provider.llm'),
]

export const DISPLAY_MODE_OPTIONS: Array<LabeledOption<TranslateDisplayMode>> = [
  option('bilingual', 'translate.displayMode.bilingual'),
  option('translation', 'translate.displayMode.translation'),
]

export const HOVER_MODE_OPTIONS: Array<LabeledOption<HoverTranslateMode>> = [
  option('off', 'translate.hoverMode.off'),
  option('alt', 'translate.hoverMode.pressKey', { key: ALT_LABEL }),
  option('ctrl', 'translate.hoverMode.pressKey', { key: CTRL_LABEL }),
  option('shift', 'translate.hoverMode.pressKey', { key: SHIFT_LABEL }),
  option('dwell', 'translate.hoverMode.dwell'),
]

export function describeHoverMode(mode: HoverTranslateMode): string {
  switch (mode) {
    case 'alt':
      return t('translate.hoverMode.hint.pressKey', { key: ALT_LABEL })
    case 'ctrl':
      return t('translate.hoverMode.hint.pressKey', { key: CTRL_LABEL })
    case 'shift':
      return t('translate.hoverMode.hint.pressKey', { key: SHIFT_LABEL })
    case 'dwell':
      return t('translate.hoverMode.hint.dwell')
    case 'off':
    default:
      return t('translate.hoverMode.hint.off')
  }
}
