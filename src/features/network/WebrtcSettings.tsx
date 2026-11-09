import { useCallback, useEffect, useState } from 'react'

import Button from '@/ui/Button'
import Select from '@/ui/Select'
import Switch from '@/ui/Switch'
import {
  sendRuntimeMessage,
  type WebrtcCandidate,
  type WebrtcLeakResult,
  type WebrtcStatus,
} from '@/utils/messaging'
import {
  webrtcBlockApis,
  webrtcHideMediaDevices,
  webrtcPolicy,
  type WebrtcPolicy,
} from '@/utils/settings'
import { useStorageItem } from '@/utils/useStorageItem'

import { Card, Row } from '@/features/options/layout'
import { ArrowUpRight } from 'lucide-react'

import { CONTROL_HINTS, POLICY_OPTIONS, policyLabel } from './webrtc'

function describeCandidate(candidate: WebrtcCandidate): string {
  if (candidate.address.endsWith('.local')) return '本机地址（已被浏览器用 mDNS 匿名化）'
  if (candidate.type === 'srflx') return '公网 IP（经 STUN 获得，开代理时应为代理出口）'
  if (candidate.type === 'relay') return '中继地址'
  if (candidate.type === 'host') return '本机网卡地址（内网 IP）'
  return candidate.type
}

function LeakTest() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<WebrtcLeakResult | null>(null)

  const run = async () => {
    setRunning(true)
    setResult(
      await sendRuntimeMessage({ type: 'test-webrtc-leak' }).catch((error: unknown) => ({
        candidates: [],
        error: String(error),
      })),
    )
    setRunning(false)
  }

  return (
    <Card
      title='泄露自测'
      desc='在你最近使用的网页里发起一次 WebRTC 连接，列出网站能拿到的地址；修改设置后可以重新检测对比。（扩展自己的页面不受防护策略约束，所以不在本页检测）'
      extra={
        <div className='flex items-center gap-2'>
          <a
            href='https://browserleaks.com/webrtc'
            target='_blank'
            rel='noreferrer'
            className='text-xs text-neutral-500 hover:text-accent-600'
          >
            在线检测
            <ArrowUpRight className='ml-0.5 inline size-3 -translate-y-px' aria-hidden />
          </a>
          <Button
            variant='primary'
            onClick={() => void run()}
            loading={running}
            className='!px-3 !py-1.5 text-sm'
          >
            开始检测
          </Button>
        </div>
      }
    >
      {result === null ? (
        <span className='text-xs text-neutral-500'>点击「开始检测」，结果以网站视角为准</span>
      ) : result.error ? (
        <span className='text-sm text-amber-600'>{result.error}</span>
      ) : (
        <div className='flex flex-col gap-2'>
          <span className='text-xs text-neutral-500'>检测网页：{result.host}</span>
          {result.blocked ? (
            <span className='text-sm text-emerald-600'>
              网页的 WebRTC 接口已被屏蔽，拿不到任何地址
            </span>
          ) : result.candidates.length === 0 ? (
            <span className='text-sm text-emerald-600'>没有暴露任何地址</span>
          ) : (
            <ul className='flex flex-col gap-1.5'>
              {result.candidates.map((candidate) => (
                <li
                  key={`${candidate.type}|${candidate.address}`}
                  className='flex items-center justify-between gap-3 text-sm'
                >
                  <code className='rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-700'>
                    {candidate.address}
                  </code>
                  <span className='text-xs text-neutral-500'>
                    {describeCandidate(candidate)} · {candidate.protocol.toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

/** 设置页「网络」下的 WebRTC 防泄露分组：防护策略、彻底屏蔽与泄露自测，修改即时生效 */
export default function WebrtcSettings() {
  const [policy, setPolicy] = useStorageItem(webrtcPolicy)
  const [blockApis, setBlockApis] = useStorageItem(webrtcBlockApis)
  const [hideDevices, setHideDevices] = useStorageItem(webrtcHideMediaDevices)
  const [status, setStatus] = useState<WebrtcStatus | null>(null)
  const [message, setMessage] = useState('')

  const refresh = useCallback(() => {
    void sendRuntimeMessage({ type: 'get-webrtc-status' })
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const changePolicy = (value: string) => {
    const next = value as WebrtcPolicy
    setMessage('')
    if (next === 'default') {
      setPolicy(next)
      window.setTimeout(refresh, 300)
      return
    }
    // 权限申请必须在用户点击的同步调用栈里发起
    void browser.permissions.request({ permissions: ['privacy'] }).then((granted) => {
      if (!granted) {
        setMessage('需要授予「更改隐私设置」权限才能开启防护')
        return
      }
      setPolicy(next)
      window.setTimeout(refresh, 300)
    })
  }

  const current = POLICY_OPTIONS.find((item) => item.value === policy) ?? POLICY_OPTIONS[0]
  const control = status?.control ? CONTROL_HINTS[status.control] : undefined
  const mismatch =
    policy !== 'default' && status?.permission && status.value && status.value !== policy

  return (
    <>
      {/* 分组标题带锚点：popup 与旧链接 #privacy 经 #network/webrtc 直达这里 */}
      <div id='webrtc' className='scroll-mt-6 pt-4'>
        <h2 className='text-base font-semibold tracking-tight text-neutral-900'>WebRTC 防泄露</h2>
        <p className='mt-1 text-sm text-neutral-500'>
          防止网页通过 WebRTC 获取你的内网 IP 和真实公网
          IP（开着代理也可能泄露）。这里的设置改完即保存，不需要点上方的「保存并应用」。
        </p>
      </div>

      <Card title='IP 防泄露策略' desc={current.hint}>
        <Row label='策略' hint='作用于整个浏览器，开启时需要授予「更改隐私设置」权限'>
          <Select
            value={policy}
            options={POLICY_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onChange={changePolicy}
            className='w-56'
          />
        </Row>
        {(message || control || (policy !== 'default' && status && !status.permission)) && (
          <p
            className={`text-xs ${
              message || control?.warn || mismatch || (status && !status.permission)
                ? 'text-amber-600'
                : 'text-neutral-500'
            }`}
          >
            {message ||
              (status && !status.permission
                ? '尚未授予权限，防护未生效：重新选择一次策略即可授权'
                : !status?.supported
                  ? '当前浏览器不支持修改 WebRTC 策略'
                  : `浏览器当前策略：${policyLabel(status.value)} · ${control?.text ?? ''}`)}
          </p>
        )}
      </Card>

      <Card
        title='更彻底的屏蔽'
        desc='直接移除网页里的接口，任何策略都绕不过去，但会影响对应功能。修改后刷新网页生效。'
      >
        <Row
          label='屏蔽网页 WebRTC 接口'
          hint='移除 RTCPeerConnection 等：网页无法建立 P2P 连接，视频会议、网页通话将不可用'
        >
          <Switch checked={blockApis} onChange={setBlockApis} />
        </Row>
        <Row
          label='隐藏摄像头和麦克风'
          hint='网页无法枚举媒体设备（常被用于设备指纹），也无法使用摄像头和麦克风'
        >
          <Switch checked={hideDevices} onChange={setHideDevices} />
        </Row>
      </Card>

      <LeakTest />
    </>
  )
}
