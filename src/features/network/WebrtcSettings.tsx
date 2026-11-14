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

import ConfirmDialog from '@/ui/ConfirmDialog'

import {
  BLOCK_APIS_IMPACT,
  CONTROL_HINTS,
  HIDE_DEVICES_IMPACT,
  POLICY_IMPACTS,
  POLICY_OPTIONS,
  policyLabel,
  type WebrtcImpact,
} from './webrtc'

/** 开启前的影响说明（确认框正文） */
function ImpactDetail({ impact }: { impact: WebrtcImpact }) {
  return (
    <>
      <div>
        <p className='font-medium text-neutral-900'>DevGo 会做什么</p>
        <p>{impact.action}</p>
      </div>
      <div>
        <p className='font-medium text-neutral-900'>可能受影响的功能</p>
        <ul className='mt-0.5 list-disc pl-4'>
          {impact.affects.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p>{impact.unaffected}</p>
      <p className='rounded-lg bg-black/[0.04] px-3 py-2 text-xs text-neutral-600'>{impact.undo}</p>
    </>
  )
}

function describeCandidate(candidate: WebrtcCandidate): string {
  if (candidate.address.endsWith('.local')) return '本机地址（浏览器已做匿名处理，安全）'
  if (candidate.type === 'srflx') return '公网 IP（开着代理时，这里应该是代理的 IP）'
  if (candidate.type === 'relay') return '中继服务器地址'
  if (candidate.type === 'host') return '局域网地址'
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
      title='检测一下'
      desc='用你最近打开的网页试一次，看看网站实际能拿到哪些地址。开着代理时，如果列表里出现你的真实 IP，说明防护没生效；改完设置可以重新检测对比。'
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
              网页音视频通话已禁用，网站拿不到任何地址
            </span>
          ) : result.candidates.length === 0 ? (
            <span className='text-sm text-emerald-600'>网站没有拿到任何地址</span>
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
  /** 待确认的开启操作：确认框里点「确认开启」才真正执行 */
  const [pending, setPending] = useState<{ impact: WebrtcImpact; apply: () => void } | null>(null)

  const refresh = useCallback(() => {
    void sendRuntimeMessage({ type: 'get-webrtc-status' })
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const applyPolicy = (next: WebrtcPolicy) => {
    // 权限申请必须在用户点击的同步调用栈里发起（这里是确认框按钮的点击）
    void browser.permissions.request({ permissions: ['privacy'] }).then((granted) => {
      if (!granted) {
        setMessage('需要授予「更改隐私设置」权限才能开启防护')
        return
      }
      setPolicy(next)
      window.setTimeout(refresh, 300)
    })
  }

  const changePolicy = (value: string) => {
    const next = value as WebrtcPolicy
    setMessage('')
    if (next === policy) return
    if (next === 'default') {
      setPolicy(next)
      window.setTimeout(refresh, 300)
      return
    }
    const impact = POLICY_IMPACTS[next]
    if (impact) setPending({ impact, apply: () => applyPolicy(next) })
    else applyPolicy(next)
  }

  /** 开关类防护：开启前先确认，关闭直接生效 */
  const confirmToggle =
    (impact: WebrtcImpact, set: (value: boolean) => void) => (next: boolean) => {
      if (!next) set(false)
      else setPending({ impact, apply: () => set(true) })
    }

  const current = POLICY_OPTIONS.find((item) => item.value === policy) ?? POLICY_OPTIONS[0]
  const control = status?.control ? CONTROL_HINTS[status.control] : undefined
  const mismatch =
    policy !== 'default' && status?.permission && status.value && status.value !== policy

  return (
    <>
      {/* 分组标题带锚点：popup 与旧链接 #privacy 经 #network/webrtc 直达这里 */}
      <div id='webrtc' className='scroll-mt-6 pt-4'>
        <h2 className='flex items-center gap-2 text-base font-semibold tracking-tight text-neutral-900'>
          真实 IP 防护
          <span className='rounded-full bg-black/5 px-2 py-px text-[11px] font-normal text-neutral-500'>
            WebRTC
          </span>
        </h2>
        <p className='mt-1 text-sm leading-relaxed text-neutral-500'>
          开着代理上网时，网站仍然可以借助浏览器的
          WebRTC（网页音视频通话用的技术）绕过代理，悄悄拿到你的真实
          IP，从而判断你大概在哪个城市、用的哪家运营商。开启防护后，网站只能看到代理的 IP。
        </p>
        <p className='mt-1.5 text-xs leading-relaxed text-neutral-500'>
          只作用于浏览器里的网页，不影响电脑上的其他应用；网页申请定位权限（精确位置）由浏览器单独询问，不在这里控制。这里的设置改完即保存，不需要点上方的「保存并应用」。
        </p>
      </div>

      <Card title='防护级别' desc={current.hint}>
        <Row label='级别' hint='对所有网页生效；第一次开启时浏览器会请求「更改隐私设置」权限'>
          <Select
            value={policy}
            options={POLICY_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onChange={changePolicy}
            className='w-56'
          />
        </Row>
        {policy !== 'default' && (
          <p className='text-xs text-neutral-500'>
            已开启：如果网页会议、语音通话连不上，先把级别改回「不防护」试试。
          </p>
        )}
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
                ? '还没授权，防护没有生效：重新选择一次级别即可授权'
                : !status?.supported
                  ? '当前浏览器不支持这项设置'
                  : `浏览器当前生效：${policyLabel(status.value)} · ${control?.text ?? ''}`)}
          </p>
        )}
      </Card>

      <Card
        title='更彻底的屏蔽'
        desc='直接关掉网页里的相关功能，任何网站都绕不过去，但对应功能会用不了。修改后刷新网页生效。'
      >
        <Row
          label='禁用网页音视频通话（WebRTC）'
          hint='网站彻底拿不到你的 IP；网页版视频会议、语音通话、P2P 传文件会用不了'
        >
          <Switch checked={blockApis} onChange={confirmToggle(BLOCK_APIS_IMPACT, setBlockApis)} />
        </Row>
        <Row
          label='隐藏摄像头和麦克风'
          hint='网站读不到你有哪些设备（常被用来识别、追踪同一台电脑），也就用不了摄像头和麦克风'
        >
          <Switch
            checked={hideDevices}
            onChange={confirmToggle(HIDE_DEVICES_IMPACT, setHideDevices)}
          />
        </Row>
      </Card>

      <LeakTest />

      {pending && (
        <ConfirmDialog
          title={pending.impact.title}
          onClose={() => setPending(null)}
          onConfirm={() => {
            pending.apply()
            setPending(null)
          }}
        >
          <ImpactDetail impact={pending.impact} />
        </ConfirmDialog>
      )}
    </>
  )
}
