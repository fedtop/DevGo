import { t } from '@/utils/i18n'
import type { WebrtcPolicy } from '@/utils/settings'

/** 真实 IP 防护（WebRTC）的级别选项，文案面向普通用户（设置页与 popup 共用）；运行时调用以跟随界面语言 */
export function getPolicyOptions(): Array<{ value: WebrtcPolicy; label: string; hint: string }> {
  return [
    {
      value: 'default',
      label: t('network.webrtc.policy.default.label'),
      hint: t('network.webrtc.policy.default.hint'),
    },
    {
      value: 'default_public_and_private_interfaces',
      label: t('network.webrtc.policy.hideVpn.label'),
      hint: t('network.webrtc.policy.hideVpn.hint'),
    },
    {
      value: 'default_public_interface_only',
      label: t('network.webrtc.policy.hideLan.label'),
      hint: t('network.webrtc.policy.hideLan.hint'),
    },
    {
      value: 'disable_non_proxied_udp',
      label: t('network.webrtc.policy.hideRealIp.label'),
      hint: t('network.webrtc.policy.hideRealIp.hint'),
    },
  ]
}

export function getControlHints(): Record<string, { text: string; warn: boolean; short?: string }> {
  return {
    controlled_by_this_extension: { text: t('network.webrtc.control.byThis'), warn: false },
    controllable_by_this_extension: { text: t('network.webrtc.control.controllable'), warn: false },
    controlled_by_other_extensions: {
      text: t('network.webrtc.control.byOther'),
      warn: true,
      short: t('network.webrtc.control.byOtherShort'),
    },
    not_controllable: {
      text: t('network.webrtc.control.locked'),
      warn: true,
      short: t('network.webrtc.control.lockedShort'),
    },
  }
}

/** 策略值 → 展示名；浏览器返回的未知值原样显示 */
export function policyLabel(value: string | null | undefined): string {
  return (
    getPolicyOptions().find((item) => item.value === value)?.label ??
    value ??
    t('network.webrtc.unknown')
  )
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

export function getPolicyImpacts(): Partial<Record<WebrtcPolicy, WebrtcImpact>> {
  return {
    default_public_and_private_interfaces: {
      title: t('network.webrtc.impact.hideVpn.title'),
      action: t('network.webrtc.impact.hideVpn.action'),
      affects: [t('network.webrtc.impact.hideVpn.affect1')],
      unaffected: t('network.webrtc.impact.unaffectedDownload'),
      undo: t('network.webrtc.impact.undoPolicy'),
    },
    default_public_interface_only: {
      title: t('network.webrtc.impact.hideLan.title'),
      action: t('network.webrtc.impact.hideLan.action'),
      affects: [
        t('network.webrtc.impact.hideLan.affect1'),
        t('network.webrtc.impact.hideLan.affect2'),
      ],
      unaffected: t('network.webrtc.impact.unaffectedDownload'),
      undo: t('network.webrtc.impact.undoPolicy'),
    },
    disable_non_proxied_udp: {
      title: t('network.webrtc.impact.hideRealIp.title'),
      action: t('network.webrtc.impact.hideRealIp.action'),
      affects: [
        t('network.webrtc.impact.hideRealIp.affect1'),
        t('network.webrtc.impact.hideRealIp.affect2'),
        t('network.webrtc.impact.hideRealIp.affect3'),
      ],
      unaffected: t('network.webrtc.impact.hideRealIp.unaffected'),
      undo: t('network.webrtc.impact.hideRealIp.undo'),
    },
  }
}

export function getBlockApisImpact(): WebrtcImpact {
  return {
    title: t('network.webrtc.impact.blockApis.title'),
    action: t('network.webrtc.impact.blockApis.action'),
    affects: [
      t('network.webrtc.impact.blockApis.affect1'),
      t('network.webrtc.impact.blockApis.affect2'),
    ],
    unaffected: t('network.webrtc.impact.unaffectedDownload'),
    undo: t('network.webrtc.impact.undoToggle'),
  }
}

export function getHideDevicesImpact(): WebrtcImpact {
  return {
    title: t('network.webrtc.impact.hideDevices.title'),
    action: t('network.webrtc.impact.hideDevices.action'),
    affects: [
      t('network.webrtc.impact.hideDevices.affect1'),
      t('network.webrtc.impact.hideDevices.affect2'),
    ],
    unaffected: t('network.webrtc.impact.hideDevices.unaffected'),
    undo: t('network.webrtc.impact.undoToggle'),
  }
}
