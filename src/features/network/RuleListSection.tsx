import { useEffect, useState } from 'react'

import Button from '@/ui/Button'
import Switch from '@/ui/Switch'
import { t } from '@/utils/i18n'
import { sendRuntimeMessage } from '@/utils/messaging'
import {
  DEFAULT_NETWORK_RULE_LIST,
  networkRuleList,
  type NetworkRuleListConfig,
} from '@/utils/settings'

import { formatRuleListTime, getRecommendedRuleLists } from './model'

interface RuleListSectionProps {
  /** 规则变化后，若当前代理依赖规则则重新应用 */
  syncProxyIfActive: () => Promise<void>
}

/** 自动模式的 AutoProxy 规则列表：下载 / 更新 / 启停 */
export default function RuleListSection({ syncProxyIfActive }: RuleListSectionProps) {
  const [ruleList, setRuleList] = useState<NetworkRuleListConfig>(DEFAULT_NETWORK_RULE_LIST)
  const [ruleListUrl, setRuleListUrl] = useState('')
  const [ruleListStatus, setRuleListStatus] = useState('')
  const [ruleListError, setRuleListError] = useState(false)
  const [ruleListBusy, setRuleListBusy] = useState(false)

  useEffect(() => {
    let active = true
    networkRuleList.getValue().then((stored) => {
      if (!active) return
      setRuleList(stored)
      setRuleListUrl(stored.url)
    })
    return () => {
      active = false
    }
  }, [])

  const toggleRuleList = async (enabled: boolean) => {
    if (ruleListBusy) return

    if (enabled && !ruleList.text.trim()) {
      setRuleListError(true)
      setRuleListStatus(t('network.ruleList.downloadFirst'))
      return
    }

    setRuleListBusy(true)
    setRuleListStatus('')
    setRuleListError(false)

    try {
      const nextRuleList = {
        ...ruleList,
        enabled,
        url: ruleListUrl.trim(),
      }
      await networkRuleList.setValue(nextRuleList)
      setRuleList(nextRuleList)
      await syncProxyIfActive()
      setRuleListStatus(enabled ? t('network.ruleList.enabled') : t('network.ruleList.disabled'))
    } catch (error) {
      setRuleListError(true)
      setRuleListStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setRuleListBusy(false)
    }
  }

  const downloadRuleList = async () => {
    if (ruleListBusy) return

    setRuleListBusy(true)
    setRuleListStatus('')
    setRuleListError(false)

    try {
      const result = await sendRuntimeMessage({
        type: 'download-network-rule-list',
        url: ruleListUrl.trim(),
      })

      if (!result.ok) {
        setRuleListError(true)
        setRuleListStatus(result.error || t('network.ruleList.downloadFailed'))
        return
      }

      const nextRuleList = await networkRuleList.getValue()
      setRuleList(nextRuleList)
      setRuleListUrl(nextRuleList.url)
      await syncProxyIfActive()
      setRuleListStatus(
        t('network.ruleList.updated', {
          proxy: nextRuleList.proxyRuleCount,
          direct: nextRuleList.directRuleCount,
        }),
      )
    } catch (error) {
      setRuleListError(true)
      setRuleListStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setRuleListBusy(false)
    }
  }

  const selectRecommendedRuleList = (url: string) => {
    setRuleListUrl(url)
    setRuleListStatus('')
    setRuleListError(false)
  }

  const ruleListTime = formatRuleListTime(ruleList.lastUpdate)

  return (
    <div className='border-t border-neutral-100 pt-3'>
      <div className='mb-2 flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='text-xs font-semibold text-neutral-700'>{t('network.ruleList.title')}</h3>
          <p className='truncate text-[10px] leading-4 text-neutral-500'>
            {ruleList.lastUpdate
              ? t('network.ruleList.summary', {
                  time: ruleListTime,
                  count: ruleList.proxyRuleCount,
                })
              : 'AutoProxy / GFWList'}
          </p>
        </div>
        <Switch checked={ruleList.enabled} onChange={toggleRuleList} disabled={ruleListBusy} />
      </div>

      <div className='flex items-center gap-2'>
        <input
          value={ruleListUrl}
          placeholder='https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt'
          onChange={(event) => setRuleListUrl(event.target.value)}
          className='min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-700 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500'
        />
        <Button onClick={downloadRuleList} loading={ruleListBusy} className='shrink-0'>
          {ruleList.text ? t('network.ruleList.update') : t('network.ruleList.download')}
        </Button>
      </div>

      <p className='mt-1.5 text-[10px] leading-4 text-neutral-500'>{t('network.ruleList.hint')}</p>
      <div className='mt-2 flex flex-wrap gap-1.5'>
        {getRecommendedRuleLists().map((item) => (
          <button
            key={item.url}
            type='button'
            title={item.url}
            onClick={() => selectRecommendedRuleList(item.url)}
            className={`rounded border px-2 py-1 text-[10px] leading-4 transition-[transform,border-color,background-color,color] duration-150 ease-out active:translate-y-px active:scale-[0.98] ${
              ruleListUrl === item.url
                ? 'border-accent-500 bg-accent-50 text-accent-700'
                : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-accent-300 hover:text-accent-600'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {(ruleListStatus || ruleList.directRuleCount > 0) && (
        <p
          className={`mt-1 text-[10px] leading-4 ${
            ruleListError ? 'text-rose-500' : 'text-neutral-500'
          }`}
        >
          {ruleListStatus ||
            t('network.ruleList.directSummary', {
              count: ruleList.directRuleCount,
              time: ruleListTime,
            })}
        </p>
      )}
    </div>
  )
}
