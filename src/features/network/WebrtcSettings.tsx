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

import { t } from '@/utils/i18n'

import {
  getBlockApisImpact,
  getControlHints,
  getHideDevicesImpact,
  getPolicyImpacts,
  getPolicyOptions,
  policyLabel,
  type WebrtcImpact,
} from './webrtc'

/** 开启前的影响说明（确认框正文） */
function ImpactDetail({ impact }: { impact: WebrtcImpact }) {
  return (
    <>
      <div>
        <p className='font-medium text-neutral-900'>{t('network.webrtc.impact.whatWeDo')}</p>
        <p>{impact.action}</p>
      </div>
      <div>
        <p className='font-medium text-neutral-900'>{t('network.webrtc.impact.affects')}</p>
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
  if (candidate.address.endsWith('.local')) return t('network.webrtc.leakTest.candidate.mdns')
  if (candidate.type === 'srflx') return t('network.webrtc.leakTest.candidate.public')
  if (candidate.type === 'relay') return t('network.webrtc.leakTest.candidate.relay')
  if (candidate.type === 'host') return t('network.webrtc.leakTest.candidate.lan')
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
      title={t('network.webrtc.leakTest.title')}
      desc={t('network.webrtc.leakTest.desc')}
      extra={
        <div className='flex items-center gap-2'>
          <a
            href='https://browserleaks.com/webrtc'
            target='_blank'
            rel='noreferrer'
            className='text-xs text-neutral-500 hover:text-accent-600'
          >
            {t('network.webrtc.leakTest.online')}
            <ArrowUpRight className='ml-0.5 inline size-3 -translate-y-px' aria-hidden />
          </a>
          <Button
            variant='primary'
            onClick={() => void run()}
            loading={running}
            className='!px-3 !py-1.5 text-sm'
          >
            {t('network.webrtc.leakTest.start')}
          </Button>
        </div>
      }
    >
      {result === null ? (
        <span className='text-xs text-neutral-500'>{t('network.webrtc.leakTest.idle')}</span>
      ) : result.error ? (
        <span className='text-sm text-amber-600'>{result.error}</span>
      ) : (
        <div className='flex flex-col gap-2'>
          <span className='text-xs text-neutral-500'>
            {t('network.webrtc.leakTest.host', { host: result.host ?? '' })}
          </span>
          {result.blocked ? (
            <span className='text-sm text-emerald-600'>{t('network.webrtc.leakTest.blocked')}</span>
          ) : result.candidates.length === 0 ? (
            <span className='text-sm text-emerald-600'>{t('network.webrtc.leakTest.none')}</span>
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
        setMessage(t('network.webrtc.permissionRequired'))
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
    const impact = getPolicyImpacts()[next]
    if (impact) setPending({ impact, apply: () => applyPolicy(next) })
    else applyPolicy(next)
  }

  /** 开关类防护：开启前先确认，关闭直接生效 */
  const confirmToggle =
    (impact: WebrtcImpact, set: (value: boolean) => void) => (next: boolean) => {
      if (!next) set(false)
      else setPending({ impact, apply: () => set(true) })
    }

  const policyOptions = getPolicyOptions()
  const current = policyOptions.find((item) => item.value === policy) ?? policyOptions[0]
  const control = status?.control ? getControlHints()[status.control] : undefined
  const mismatch =
    policy !== 'default' && status?.permission && status.value && status.value !== policy

  return (
    <>
      {/* 分组标题带锚点：popup 与旧链接 #privacy 经 #network/webrtc 直达这里 */}
      <div id='webrtc' className='scroll-mt-6 pt-4'>
        <h2 className='flex items-center gap-2 text-base font-semibold tracking-tight text-neutral-900'>
          {t('network.webrtc.title')}
          <span className='rounded-full bg-black/5 px-2 py-px text-[11px] font-normal text-neutral-500'>
            WebRTC
          </span>
        </h2>
        <p className='mt-1 text-sm leading-relaxed text-neutral-500'>{t('network.webrtc.intro')}</p>
        <p className='mt-1.5 text-xs leading-relaxed text-neutral-500'>
          {t('network.webrtc.scope')}
        </p>
      </div>

      <Card title={t('network.webrtc.level.title')} desc={current.hint}>
        <Row label={t('network.webrtc.level.label')} hint={t('network.webrtc.level.hint')}>
          <Select
            value={policy}
            options={policyOptions.map(({ value, label }) => ({ value, label }))}
            onChange={changePolicy}
            className='w-56'
          />
        </Row>
        {policy !== 'default' && (
          <p className='text-xs text-neutral-500'>{t('network.webrtc.level.enabledTip')}</p>
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
                ? t('network.webrtc.level.notGranted')
                : !status?.supported
                  ? t('network.webrtc.level.unsupported')
                  : t('network.webrtc.level.effective', {
                      policy: policyLabel(status.value),
                      control: control?.text ?? '',
                    }))}
          </p>
        )}
      </Card>

      <Card title={t('network.webrtc.strict.title')} desc={t('network.webrtc.strict.desc')}>
        <Row
          label={t('network.webrtc.strict.blockApis')}
          hint={t('network.webrtc.strict.blockApisHint')}
        >
          <Switch
            checked={blockApis}
            onChange={confirmToggle(getBlockApisImpact(), setBlockApis)}
          />
        </Row>
        <Row
          label={t('network.webrtc.strict.hideDevices')}
          hint={t('network.webrtc.strict.hideDevicesHint')}
        >
          <Switch
            checked={hideDevices}
            onChange={confirmToggle(getHideDevicesImpact(), setHideDevices)}
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
