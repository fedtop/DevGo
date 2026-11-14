/**
 * 界面多语言：轻量 t() + 按模块拆分的语言文件（src/locales/<locale>/<模块>.json）。
 *
 * - 文案 key 写成「模块.分组.名称」，类型由 zh_CN 语言文件推导，写错 key 会编译报错；
 * - 插值用 `{name}` 占位：t('popup.tools.count', { count: 3 })；
 * - 英文单复数：带 count 参数时，若英文里有 `<key>_one` 且 count === 1，优先用它；
 * - 当前语言由设置「界面语言」决定（跟随浏览器 / 中文 / English），各上下文启动时先 await initI18n()；
 * - t() 只能在运行时（渲染、事件处理）调用，不要在模块顶层求值，否则会固定成初始化前的语言。
 *
 * 扩展名称、描述、快捷键说明由浏览器读取 public/_locales，只跟随浏览器语言。
 */

import { useSyncExternalStore } from 'react'

import enAi from '@/locales/en/ai.json'
import enAssistant from '@/locales/en/assistant.json'
import enBackground from '@/locales/en/background.json'
import enCommon from '@/locales/en/common.json'
import enDock from '@/locales/en/dock.json'
import enGithub from '@/locales/en/github.json'
import enNetwork from '@/locales/en/network.json'
import enNewtab from '@/locales/en/newtab.json'
import enOptions from '@/locales/en/options.json'
import enPopup from '@/locales/en/popup.json'
import enSelection from '@/locales/en/selection.json'
import enTranslate from '@/locales/en/translate.json'
import zhAi from '@/locales/zh_CN/ai.json'
import zhAssistant from '@/locales/zh_CN/assistant.json'
import zhBackground from '@/locales/zh_CN/background.json'
import zhCommon from '@/locales/zh_CN/common.json'
import zhDock from '@/locales/zh_CN/dock.json'
import zhGithub from '@/locales/zh_CN/github.json'
import zhNetwork from '@/locales/zh_CN/network.json'
import zhNewtab from '@/locales/zh_CN/newtab.json'
import zhOptions from '@/locales/zh_CN/options.json'
import zhPopup from '@/locales/zh_CN/popup.json'
import zhSelection from '@/locales/zh_CN/selection.json'
import zhTranslate from '@/locales/zh_CN/translate.json'

const zhCN = {
  common: zhCommon,
  popup: zhPopup,
  options: zhOptions,
  network: zhNetwork,
  assistant: zhAssistant,
  newtab: zhNewtab,
  selection: zhSelection,
  translate: zhTranslate,
  ai: zhAi,
  background: zhBackground,
  github: zhGithub,
  dock: zhDock,
}

const en = {
  common: enCommon,
  popup: enPopup,
  options: enOptions,
  network: enNetwork,
  assistant: enAssistant,
  newtab: enNewtab,
  selection: enSelection,
  translate: enTranslate,
  ai: enAi,
  background: enBackground,
  github: enGithub,
  dock: enDock,
}

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? Leaves<T[K], `${Prefix}${K}.`>
      : never
}[keyof T & string]

/** 所有文案 key（由中文语言文件推导） */
export type MessageKey = Leaves<typeof zhCN>
export type MessageParams = Record<string, string | number>

export type Locale = 'zh-CN' | 'en'
export type UiLanguage = 'auto' | Locale

export const UI_LANGUAGES: readonly UiLanguage[] = ['auto', 'zh-CN', 'en']

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && (UI_LANGUAGES as readonly string[]).includes(value)
}

/** 界面语言设置：默认跟随浏览器 */
export const uiLanguage = storage.defineItem<UiLanguage>('local:uiLanguage', {
  fallback: 'auto',
})

const DICTIONARIES: Record<Locale, unknown> = { 'zh-CN': zhCN, en }

function browserLocale(): Locale {
  let lang = ''
  try {
    lang = browser.i18n?.getUILanguage?.() ?? ''
  } catch {
    // 某些上下文（如被宿主页面覆盖的环境）取不到，退回 navigator
  }
  if (!lang && typeof navigator !== 'undefined') lang = navigator.language
  return /^zh\b/i.test(lang) ? 'zh-CN' : 'en'
}

export function resolveLocale(setting: UiLanguage): Locale {
  return setting === 'auto' ? browserLocale() : setting
}

let currentLocale: Locale = browserLocale()
const listeners = new Set<(locale: Locale) => void>()

export function getLocale(): Locale {
  return currentLocale
}

/** 扩展自己的页面（popup / 设置页 / 侧边栏 / 新标签页）同步 <html lang>；内容脚本不改宿主页面 */
function syncDocumentLang() {
  if (typeof document === 'undefined' || !/-extension:$/.test(location.protocol)) return
  document.documentElement.lang = currentLocale
}

function setLocale(locale: Locale) {
  if (locale === currentLocale) return
  currentLocale = locale
  syncDocumentLang()
  listeners.forEach((listener) => listener(locale))
}

/** 订阅语言变化，返回取消订阅函数 */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let initPromise: Promise<Locale> | undefined

/**
 * 读取「界面语言」设置并开始跟随变化。各上下文在渲染 / 处理消息前 await 一次即可，重复调用复用同一个 Promise。
 */
export function initI18n(): Promise<Locale> {
  initPromise ??= (async () => {
    const setting = await uiLanguage.getValue().catch(() => 'auto' as const)
    setLocale(resolveLocale(isUiLanguage(setting) ? setting : 'auto'))
    syncDocumentLang()
    uiLanguage.watch((next) => setLocale(resolveLocale(isUiLanguage(next) ? next : 'auto')))
    return currentLocale
  })()
  return initPromise
}

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** 取当前语言的文案；英文缺失时回退到中文，都没有则返回 key 本身 */
export function t(key: MessageKey, params?: MessageParams): string {
  const dict = DICTIONARIES[currentLocale]
  let template: string | undefined
  if (params?.count === 1) template = lookup(dict, `${key}_one`)
  template ??= lookup(dict, key) ?? lookup(zhCN, key) ?? key
  return interpolate(template, params)
}

/** 当前语言是否中文（少数需要按语言分支的逻辑使用，如日期格式） */
export function isZhLocale(): boolean {
  return currentLocale === 'zh-CN'
}

/** React：语言变化时让组件重新渲染，返回当前语言 */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, getLocale, getLocale)
}
