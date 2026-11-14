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

/** 开启某项防护前的说明：实际做了什么、会影响哪些网页功能（避免用户以为是 bug） */
export interface WebrtcImpact {
  title: string
  /** DevGo 实际做的事 */
  action: string
  /** 可能受影响的网页功能 */
  affects: string[]
  /** 不受影响的 */
  unaffected: string
  /** 出问题时怎么恢复 */
  undo: string
}

export const POLICY_IMPACTS: Partial<Record<WebrtcPolicy, WebrtcImpact>> = {
  default_public_and_private_interfaces: {
    title: '开启「隐藏 VPN / 虚拟网卡」',
    action:
      '修改浏览器的 WebRTC 设置，只允许网页使用默认网卡建立连接，VPN、虚拟机等额外网卡的地址不再提供给网页。对所有网页生效。',
    affects: ['只能通过 VPN / 虚拟网卡才能连通的网页音视频通话，可能连不上'],
    unaffected: '普通浏览、看视频、下载，以及电脑上的客户端 App 都不受影响。',
    undo: '遇到网页通话异常，把级别改回「不防护」即可恢复。',
  },
  default_public_interface_only: {
    title: '开启「隐藏局域网地址」',
    action:
      '修改浏览器的 WebRTC 设置，网页只能拿到公网地址，拿不到你家里或公司内网的地址。对所有网页生效。',
    affects: [
      '同一 Wi-Fi / 内网下的网页通话、P2P 传文件不能直连，会改走公网，可能稍慢',
      '只在内网可用的网页会议系统可能连不上',
    ],
    unaffected: '普通浏览、看视频、下载，以及电脑上的客户端 App 都不受影响。',
    undo: '遇到网页通话异常，把级别改回「不防护」即可恢复。',
  },
  disable_non_proxied_udp: {
    title: '开启「隐藏真实 IP」',
    action:
      '修改浏览器的 WebRTC 设置（禁止不经代理的 UDP 连接），网页的音视频连接只能通过代理建立，网站因此拿不到你的真实 IP。对所有网页生效。',
    affects: [
      '网页版视频会议、语音通话（如腾讯会议 / 飞书 / Google Meet 网页版）可能变慢、卡顿或连不上，代理不支持 UDP 时更明显',
      '网页 P2P 传文件、网页直播连麦、部分网页游戏的实时连接',
      '没开代理时，部分网页通话也可能无法建立连接',
    ],
    unaffected: '普通浏览、看视频、下载，以及电脑上的客户端 App（如会议客户端）都不受影响。',
    undo: '遇到网页会议连不上，先把级别改回「不防护」试试；弹窗「网络」页能看到防护是否开启。',
  },
}

export const BLOCK_APIS_IMPACT: WebrtcImpact = {
  title: '禁用网页音视频通话',
  action:
    '在每个网页加载前移除 WebRTC 相关接口（RTCPeerConnection 等），网站彻底无法建立音视频连接，也就拿不到你的任何 IP。对所有网页生效，刷新网页后生效。',
  affects: [
    '所有网页版视频会议、语音通话、屏幕共享都无法使用，网站可能提示「浏览器不支持」',
    '网页 P2P 传文件、网页直播连麦、在线客服的语音 / 视频通话',
  ],
  unaffected: '普通浏览、看视频、下载，以及电脑上的客户端 App 都不受影响。',
  undo: '关掉这个开关，再刷新网页即可恢复。',
}

export const HIDE_DEVICES_IMPACT: WebrtcImpact = {
  title: '隐藏摄像头和麦克风',
  action:
    '在每个网页加载前屏蔽读取媒体设备的接口，网站读不到你有哪些摄像头、麦克风，也无法调用它们。对所有网页生效，刷新网页后生效。',
  affects: [
    '网页视频会议里打不开摄像头和麦克风',
    '网页录音、录像、拍照上传、语音输入、人脸核验等功能',
  ],
  unaffected: '普通浏览、看视频，以及电脑上的客户端 App 都不受影响。',
  undo: '关掉这个开关，再刷新网页即可恢复。',
}
