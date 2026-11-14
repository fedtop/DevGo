/**
 * 网络面板的常量与纯函数（不依赖 React / 浏览器 API）。
 */
import { getLocale, t, type MessageKey } from '@/utils/i18n'
import type { NetworkProxyStatus } from '@/utils/messaging'
import { normalizeBypassList } from '@/utils/network'
import {
  DEFAULT_NETWORK_PROXY_PROFILE,
  type NetworkCustomProxyModeProfile,
  type NetworkMode,
  type NetworkProxyProfile,
  type NetworkProxyProfileMode,
  type NetworkProxyScheme,
} from '@/utils/settings'

/** 内置网络模式；运行时调用以跟随界面语言 */
export function getModeOptions(): Array<{
  value: NetworkMode
  label: string
  description: string
}> {
  return [
    {
      value: 'direct',
      label: t('network.mode.direct.label'),
      description: t('network.mode.direct.desc'),
    },
    {
      value: 'system',
      label: t('network.mode.system.label'),
      description: t('network.mode.system.desc'),
    },
    {
      value: 'scenario',
      label: t('network.mode.scenario.label'),
      description: t('network.mode.scenario.desc'),
    },
    {
      value: 'global',
      label: t('network.mode.global.label'),
      description: t('network.mode.global.desc'),
    },
  ]
}

export const SCHEME_OPTIONS: Array<{ value: NetworkProxyScheme; label: string }> = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks4', label: 'SOCKS4' },
  { value: 'socks5', label: 'SOCKS5' },
]

/** 代理模式与自动模式都依赖下方填写的固定代理（host/port/绕过列表） */
export function usesProxyProfile(mode: NetworkMode): boolean {
  return mode === 'global' || mode === 'scenario'
}

const CONTROL_LABELS: Record<string, MessageKey> = {
  not_controllable: 'network.proxyControl.notControllable',
  controlled_by_other_extensions: 'network.proxyControl.byOther',
  controllable_by_this_extension: 'network.proxyControl.controllable',
  controlled_by_this_extension: 'network.proxyControl.byThis',
}

const RECOMMENDED_RULE_LIST_SOURCES = [
  { source: 'GitHub', url: 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt' },
  { source: 'GitLab', url: 'https://gitlab.com/gfwlist/gfwlist/raw/master/gfwlist.txt' },
  { source: 'jsDelivr', url: 'https://cdn.jsdelivr.net/gh/gfwlist/gfwlist@master/gfwlist.txt' },
  { source: 'Pagure', url: 'https://pagure.io/gfwlist/raw/master/f/gfwlist.txt' },
]

/** 推荐的规则列表地址（「规则 N · 来源」）；运行时调用以跟随界面语言 */
export function getRecommendedRuleLists(): Array<{ label: string; url: string }> {
  return RECOMMENDED_RULE_LIST_SOURCES.map(({ source, url }, index) => ({
    label: t('network.ruleList.recommended', { index: index + 1, source }),
    url,
  }))
}

export const CUSTOM_PROXY_MODE_NAME_MAX = 24

export function createDefaultProxyProfile(): NetworkProxyProfile {
  return {
    ...DEFAULT_NETWORK_PROXY_PROFILE,
    bypassList: [...DEFAULT_NETWORK_PROXY_PROFILE.bypassList],
  }
}

export function getDefaultBypassText(): string {
  return DEFAULT_NETWORK_PROXY_PROFILE.bypassList.join('\n')
}

export function normalizeCustomProxyModeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, CUSTOM_PROXY_MODE_NAME_MAX)
}

export function uniqueCustomProxyModeName(
  name: string,
  modes: NetworkCustomProxyModeProfile[],
): string {
  const used = new Set(modes.map((item) => item.name))
  if (!used.has(name)) return name

  for (let index = 2; index < 100; index += 1) {
    const next = `${name} ${index}`
    if (!used.has(next)) return next
  }

  return `${name} ${Date.now()}`
}

export function createCustomProxyModeSnapshot(
  name: string,
  proxyProfile: NetworkProxyProfile,
): NetworkCustomProxyModeProfile {
  return {
    id: crypto.randomUUID(),
    name,
    proxyProfile,
    updatedAt: new Date().toISOString(),
  }
}

export function nextCustomProxyModeIdOrEmpty(
  modes: NetworkCustomProxyModeProfile[],
  activeId: string,
): string {
  return modes.some((item) => item.id === activeId) ? activeId : ''
}

export function normalizeProfileFromForm(
  profile: NetworkProxyProfile,
  bypassText: string,
): NetworkProxyProfile {
  return {
    ...profile,
    host: profile.host.trim(),
    port: Number.isFinite(profile.port) ? Math.trunc(profile.port) : 0,
    bypassList: normalizeBypassList(bypassText),
  }
}

export function proxyProfileModeOf(mode: NetworkMode): NetworkProxyProfileMode | null {
  if (mode === 'global' || mode === 'scenario') return mode
  return null
}

export function getStatusText(status: NetworkProxyStatus | null): string {
  if (!status) return ''
  if (!status.ok) return status.error || t('network.status.applyFailed')
  const key = status.levelOfControl ? CONTROL_LABELS[status.levelOfControl] : undefined
  return key ? t(key) : t('network.status.synced')
}

export function formatRuleListTime(value: string): string {
  if (!value) return ''

  try {
    return new Intl.DateTimeFormat(getLocale(), {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
}
