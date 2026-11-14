/**
 * 翻译语言表与各引擎语言代码映射。
 *
 * 内部统一使用 BCP 47 风格代码（zh-CN / en / ja ...），发请求前再映射到各引擎的方言：
 * - 微软：zh-Hans / zh-Hant
 * - Google：zh-CN / zh-TW
 * - 大模型：直接用语言的英文名 + 本地名，提示词里更不容易歧义
 */

import { t, type MessageKey } from '@/utils/i18n'

export type TranslateLangCode =
  | 'zh-CN'
  | 'zh-TW'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'pt'
  | 'it'
  | 'vi'
  | 'th'
  | 'ar'
  | 'id'
  | 'tr'

/** 设置里的目标语言：auto = 中文页面译成英文，其余页面译成简体中文 */
export type TranslateTargetSetting = 'auto' | TranslateLangCode

interface LanguageInfo {
  code: TranslateLangCode
  /** 界面展示名（文案 key，渲染时再取当前界面语言） */
  labelKey: MessageKey
  /** 给大模型的语言名 */
  llmName: string
  microsoft: string
  google: string
}

export const TRANSLATE_LANGUAGES: readonly LanguageInfo[] = [
  {
    code: 'zh-CN',
    labelKey: 'translate.languages.zhCN',
    llmName: 'Simplified Chinese (简体中文)',
    microsoft: 'zh-Hans',
    google: 'zh-CN',
  },
  {
    code: 'zh-TW',
    labelKey: 'translate.languages.zhTW',
    llmName: 'Traditional Chinese (繁體中文)',
    microsoft: 'zh-Hant',
    google: 'zh-TW',
  },
  {
    code: 'en',
    labelKey: 'translate.languages.en',
    llmName: 'English',
    microsoft: 'en',
    google: 'en',
  },
  {
    code: 'ja',
    labelKey: 'translate.languages.ja',
    llmName: 'Japanese (日本語)',
    microsoft: 'ja',
    google: 'ja',
  },
  {
    code: 'ko',
    labelKey: 'translate.languages.ko',
    llmName: 'Korean (한국어)',
    microsoft: 'ko',
    google: 'ko',
  },
  {
    code: 'fr',
    labelKey: 'translate.languages.fr',
    llmName: 'French',
    microsoft: 'fr',
    google: 'fr',
  },
  {
    code: 'de',
    labelKey: 'translate.languages.de',
    llmName: 'German',
    microsoft: 'de',
    google: 'de',
  },
  {
    code: 'es',
    labelKey: 'translate.languages.es',
    llmName: 'Spanish',
    microsoft: 'es',
    google: 'es',
  },
  {
    code: 'ru',
    labelKey: 'translate.languages.ru',
    llmName: 'Russian',
    microsoft: 'ru',
    google: 'ru',
  },
  {
    code: 'pt',
    labelKey: 'translate.languages.pt',
    llmName: 'Portuguese',
    microsoft: 'pt',
    google: 'pt',
  },
  {
    code: 'it',
    labelKey: 'translate.languages.it',
    llmName: 'Italian',
    microsoft: 'it',
    google: 'it',
  },
  {
    code: 'vi',
    labelKey: 'translate.languages.vi',
    llmName: 'Vietnamese',
    microsoft: 'vi',
    google: 'vi',
  },
  {
    code: 'th',
    labelKey: 'translate.languages.th',
    llmName: 'Thai',
    microsoft: 'th',
    google: 'th',
  },
  {
    code: 'ar',
    labelKey: 'translate.languages.ar',
    llmName: 'Arabic',
    microsoft: 'ar',
    google: 'ar',
  },
  {
    code: 'id',
    labelKey: 'translate.languages.id',
    llmName: 'Indonesian',
    microsoft: 'id',
    google: 'id',
  },
  {
    code: 'tr',
    labelKey: 'translate.languages.tr',
    llmName: 'Turkish',
    microsoft: 'tr',
    google: 'tr',
  },
]

const LANGUAGE_MAP = new Map(TRANSLATE_LANGUAGES.map((lang) => [lang.code, lang]))

/**
 * 目标语言下拉选项。label 用 getter 在读取时取当前界面语言的文案（不能在模块顶层求值）。
 */
export const TARGET_LANGUAGE_OPTIONS: Array<{ value: TranslateTargetSetting; label: string }> = [
  {
    value: 'auto',
    get label() {
      return t('translate.languages.auto')
    },
  },
  ...TRANSLATE_LANGUAGES.map((lang) => ({
    value: lang.code,
    get label() {
      return t(lang.labelKey)
    },
  })),
]

export function isTranslateLangCode(value: unknown): value is TranslateLangCode {
  return typeof value === 'string' && LANGUAGE_MAP.has(value as TranslateLangCode)
}

export function isTranslateTargetSetting(value: unknown): value is TranslateTargetSetting {
  return value === 'auto' || isTranslateLangCode(value)
}

export function getLanguageLabel(code: TranslateLangCode): string {
  const info = LANGUAGE_MAP.get(code)
  return info ? t(info.labelKey) : code
}

export function toMicrosoftLang(code: TranslateLangCode): string {
  return LANGUAGE_MAP.get(code)?.microsoft ?? code
}

export function toGoogleLang(code: TranslateLangCode): string {
  return LANGUAGE_MAP.get(code)?.google ?? code
}

export function toLlmLanguageName(code: TranslateLangCode): string {
  return LANGUAGE_MAP.get(code)?.llmName ?? code
}

/* ------------------------------ 轻量书写系统识别 ------------------------------ */

const HAN_RE = /\p{Script=Han}/gu
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu
const HANGUL_RE = /\p{Script=Hangul}/gu
const LETTER_RE = /\p{L}/gu

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

/** 文本主要书写系统（只区分能可靠识别的几类；拉丁语系之间无法区分） */
export type TextScript = 'han' | 'kana' | 'hangul' | 'other' | 'none'

export function detectScript(text: string): TextScript {
  const letters = countMatches(text, LETTER_RE)
  if (letters === 0) return 'none'

  const kana = countMatches(text, KANA_RE)
  if (kana / letters > 0.1) return 'kana'

  const hangul = countMatches(text, HANGUL_RE)
  if (hangul / letters > 0.4) return 'hangul'

  const han = countMatches(text, HAN_RE)
  if (han / letters > 0.4) return 'han'

  return 'other'
}

/** auto 模式下按源文本决定目标语言：中文 → 英文，其余 → 简体中文 */
export function resolveAutoTarget(sampleText: string): TranslateLangCode {
  return detectScript(sampleText) === 'han' ? 'en' : 'zh-CN'
}

export function resolveTargetLang(
  setting: TranslateTargetSetting,
  sampleText: string,
): TranslateLangCode {
  return setting === 'auto' ? resolveAutoTarget(sampleText) : setting
}

/**
 * 文本是否「明显已是目标语言」，用于本地跳过无需翻译的段落、节省请求。
 * 只对能靠书写系统判定的语言生效（中日韩）；拉丁语系交给引擎判断。
 */
export function isLikelyInTargetLang(text: string, target: TranslateLangCode): boolean {
  const script = detectScript(text)
  if (target === 'zh-CN' || target === 'zh-TW') return script === 'han'
  if (target === 'ja') return script === 'kana'
  if (target === 'ko') return script === 'hangul'
  return false
}
