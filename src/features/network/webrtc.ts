import type { WebrtcPolicy } from '@/utils/settings'

/** WebRTC 防护策略选项（设置页与 popup 共用） */
export const POLICY_OPTIONS: Array<{ value: WebrtcPolicy; label: string; hint: string }> = [
  {
    value: 'default',
    label: '关闭（浏览器默认）',
    hint: '不干预：网页可以通过 WebRTC 拿到内网 IP 与真实公网 IP',
  },
  {
    value: 'default_public_and_private_interfaces',
    label: '只用默认网卡',
    hint: '只使用默认路由的网卡（公网 + 内网地址），隐藏 VPN、虚拟机等其他网卡的地址',
  },
  {
    value: 'default_public_interface_only',
    label: '隐藏内网 IP',
    hint: '只暴露默认网卡的公网地址，音视频通话不受影响',
  },
  {
    value: 'disable_non_proxied_udp',
    label: '防止真实 IP 泄露（推荐）',
    hint: 'WebRTC 只能经代理连接：开着代理时网页拿不到真实 IP；代理不支持 UDP 时网页通话可能变慢或失败',
  },
]

export const CONTROL_HINTS: Record<string, { text: string; warn: boolean; short?: string }> = {
  controlled_by_this_extension: { text: '已由 DevGo 接管', warn: false },
  controllable_by_this_extension: { text: '未接管（浏览器默认）', warn: false },
  controlled_by_other_extensions: {
    text: '被其他扩展接管（如 WebRTC Control），DevGo 的设置不会生效，请先停用该扩展',
    warn: true,
    short: '被其他扩展接管，防护未生效',
  },
  not_controllable: {
    text: '浏览器策略锁定，扩展无法修改',
    warn: true,
    short: '浏览器策略锁定，防护未生效',
  },
}

/** 策略值 → 展示名；浏览器返回的未知值原样显示 */
export function policyLabel(value: string | null | undefined): string {
  return POLICY_OPTIONS.find((item) => item.value === value)?.label ?? value ?? '未知'
}
