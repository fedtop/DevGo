import { useEffect, useState } from 'react'
import { ArrowUpRight, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'

import { sendRuntimeMessage, type WebrtcStatus } from '@/utils/messaging'
import { webrtcBlockApis, webrtcPolicy } from '@/utils/settings'
import { useStorageItem } from '@/utils/useStorageItem'

import { CONTROL_HINTS, policyLabel } from './webrtc'

/** popup「网络」页的 WebRTC 防泄露状态：只展示是否生效，点击进设置页对应分组修改 */
export default function WebrtcStatusSection({
  proxyActive,
  onOpenSettings,
}: {
  /** 当前网络模式会走代理（此时 WebRTC 最容易暴露真实 IP） */
  proxyActive: boolean
  onOpenSettings: () => void
}) {
  const [policy] = useStorageItem(webrtcPolicy)
  const [blockApis] = useStorageItem(webrtcBlockApis)
  const [status, setStatus] = useState<WebrtcStatus | null>(null)

  useEffect(() => {
    sendRuntimeMessage({ type: 'get-webrtc-status' })
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [policy])

  const enabled = policy !== 'default' || blockApis
  const control = status?.control ? CONTROL_HINTS[status.control] : undefined
  // 选了策略却没生效：没授权，或被其他扩展 / 浏览器策略接管
  const problem =
    policy === 'default' || !status
      ? ''
      : !status.permission
        ? '还没授权，防护没有生效'
        : (control?.short ?? '')

  const detail = problem
    ? problem
    : enabled
      ? [policy !== 'default' && policyLabel(policy), blockApis && '已禁用网页音视频通话']
          .filter(Boolean)
          .join(' · ')
      : proxyActive
        ? '未开启：开着代理，网站仍可能看到你的真实 IP'
        : '未开启：防止网站绕过代理看到你的真实 IP'

  const Icon = problem ? ShieldAlert : enabled ? ShieldCheck : ShieldOff

  return (
    <section className='rounded-lg border border-neutral-200 bg-white p-2.5'>
      <button
        type='button'
        onClick={onOpenSettings}
        title='网站可能借助 WebRTC 绕过代理拿到你的真实 IP；点击去设置页开启防护'
        className='group flex w-full items-center justify-between gap-3 text-left'
      >
        <span className='flex min-w-0 items-center gap-2'>
          <Icon
            className={`size-4 shrink-0 ${
              problem ? 'text-amber-600' : enabled ? 'text-emerald-600' : 'text-neutral-400'
            }`}
            strokeWidth={1.8}
            aria-hidden
          />
          <span className='min-w-0'>
            <span className='block text-sm font-semibold text-neutral-800'>真实 IP 防护</span>
            <span
              className={`block truncate text-xs ${
                problem || (!enabled && proxyActive) ? 'text-amber-600' : 'text-neutral-500'
              }`}
            >
              {detail}
            </span>
          </span>
        </span>
        <span className='shrink-0 text-xs text-neutral-500 group-hover:text-accent-600'>
          设置
          <ArrowUpRight className='ml-0.5 inline size-3 -translate-y-px' aria-hidden />
        </span>
      </button>
    </section>
  )
}
