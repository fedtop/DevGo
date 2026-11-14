/**
 * 翻译链路统一错误类型。
 *
 * Background 抛出 → 序列化为 { code, message } 经端口回传 → 内容脚本按 code 决定
 * 是否提示用户去配置、是否允许重试。
 */

import { t } from '@/utils/i18n'

export type TranslateErrorCode =
  /** 配置缺失或无效（如 AI 翻译未填写接口地址 / 模型） */
  | 'config'
  /** 鉴权失败（API Key 错误、token 失效） */
  | 'auth'
  /** 触发限流 */
  | 'rate-limit'
  /** 网络不可达 / 请求失败 */
  | 'network'
  /** 服务端返回错误 */
  | 'server'
  /** 返回内容无法解析 / 缺少对应段落 */
  | 'parse'
  /** 被取消 */
  | 'aborted'
  | 'unknown'

export interface TranslateErrorPayload {
  code: TranslateErrorCode
  message: string
}

export class TranslateError extends Error {
  readonly code: TranslateErrorCode

  constructor(code: TranslateErrorCode, message: string) {
    super(message)
    this.name = 'TranslateError'
    this.code = code
  }

  toJSON(): TranslateErrorPayload {
    return { code: this.code, message: this.message }
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof TranslateError && error.code === 'aborted')
  )
}

export function toTranslateError(error: unknown): TranslateError {
  if (error instanceof TranslateError) return error
  if (isAbortError(error)) return new TranslateError('aborted', t('translate.errors.aborted'))
  if (error instanceof TypeError) {
    // fetch 网络层失败统一抛 TypeError（DNS、断网、证书、被拦截等）
    return new TranslateError('network', t('translate.errors.network', { message: error.message }))
  }
  const message = error instanceof Error ? error.message : String(error)
  return new TranslateError('unknown', message || t('translate.errors.unknown'))
}

/** 按 HTTP 状态码归类错误 */
export function httpStatusToError(status: number, detail: string): TranslateError {
  const suffix = detail ? t('translate.errors.detailSuffix', { detail }) : ''
  if (status === 401 || status === 403) {
    return new TranslateError('auth', t('translate.errors.auth', { status, detail: suffix }))
  }
  if (status === 429)
    return new TranslateError('rate-limit', t('translate.errors.rateLimit', { detail: suffix }))
  if (status === 404)
    return new TranslateError('config', t('translate.errors.notFound', { detail: suffix }))
  if (status >= 400 && status < 500) {
    return new TranslateError(
      'config',
      t('translate.errors.badRequest', { status, detail: suffix }),
    )
  }
  return new TranslateError('server', t('translate.errors.server', { status, detail: suffix }))
}

/**
 * AI 服务错误的用户提示（不含服务端原文：原文可能是英文、含打码的 Key，只适合放在 title 里排查）。
 */
export function describeServiceError(code: TranslateErrorCode | 'timeout'): string {
  switch (code) {
    case 'auth':
      return t('translate.serviceError.auth')
    case 'config':
      return t('translate.serviceError.config')
    case 'network':
      return t('translate.serviceError.network')
    case 'timeout':
      return t('translate.serviceError.timeout')
    case 'rate-limit':
      return t('translate.serviceError.rateLimit')
    case 'server':
      return t('translate.serviceError.server')
    case 'parse':
      return t('translate.serviceError.parse')
    default:
      return t('translate.serviceError.default')
  }
}
