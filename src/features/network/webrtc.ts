import type { WebrtcPolicy } from '@/utils/settings'

/** 真实 IP 防护（WebRTC）的级别选项，文案面向普通用户（设置页与 popup 共用） */
export const POLICY_OPTIONS: Array<{ value: WebrtcPolicy; label: string; hint: string }> = [
  {
    value: 'default',
    label: '不防护（浏览器默认）',
    hint: '网页可以悄悄拿到你的真实 IP 和局域网地址，开着代理也一样',
  },
  {
    value: 'default_public_and_private_interfaces',
    label: '隐藏 VPN / 虚拟网卡',
    hint: '不暴露 VPN、虚拟机等额外网卡的地址；真实 IP 和局域网地址仍然可见',
  },
  {
    value: 'default_public_interface_only',
    label: '隐藏局域网地址',
    hint: '网页看不到你家里或公司内网的地址；真实 IP 仍然可见，网页视频通话不受影响',
  },
  {
    value: 'disable_non_proxied_udp',
    label: '隐藏真实 IP（推荐）',
    hint: '开着代理时，网页只能看到代理的 IP，没法据此判断你的真实位置和运营商；少数网页视频通话可能变慢或连不上',
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
