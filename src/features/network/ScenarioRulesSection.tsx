import { useEffect, useState } from 'react'

import Button from '@/ui/Button'
import Tabs from '@/ui/Tabs'
import { t } from '@/utils/i18n'
import { normalizeProxyList, type NetworkScenarioDefaultAction } from '@/utils/network'
import { networkScenarioDefaultAction, networkScenarioProxyList } from '@/utils/settings'
import { useStorageItem } from '@/utils/useStorageItem'

/** 列表里覆盖该主机的条目（自身或父域名；通配符条目按通配匹配） */
function findCoveringEntries(list: string[], host: string): string[] {
  return list.filter((entry) => {
    if (entry.includes('*')) {
      const source = entry
        .replace(/^\*\./, '')
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')
      return new RegExp(`(?:^|\\.)${source}$`).test(host)
    }
    return host === entry || host.endsWith(`.${entry}`)
  })
}

function getDefaultActionOptions(): Array<{ value: NetworkScenarioDefaultAction; label: string }> {
  return [
    { value: 'direct', label: t('network.scenario.defaultAction.direct') },
    { value: 'proxy', label: t('network.scenario.defaultAction.proxy') },
  ]
}

/**
 * 自动模式下「当前站点走代理」的开关：已被代理域名（含父域名、通配）覆盖时为已开启，
 * 关闭时移除所有覆盖条目。popup 与设置页共用。
 */
export function useScenarioHostProxy(
  currentHost: string,
  syncProxyIfActive: () => Promise<void>,
  onHostProxied?: (host: string) => void,
) {
  const [proxyList, setProxyList] = useStorageItem(networkScenarioProxyList)
  const coveringEntries = currentHost ? findCoveringEntries(proxyList, currentHost) : []
  const proxied = coveringEntries.length > 0

  /** 返回给用户看的结果说明 */
  const toggle = async (): Promise<string> => {
    if (!currentHost) return ''
    if (proxied) {
      setProxyList(proxyList.filter((item) => !coveringEntries.includes(item)))
      await syncProxyIfActive().catch(() => undefined)
      return t('network.scenario.removed', {
        hosts: coveringEntries.join(t('network.scenario.listSeparator')),
      })
    }
    setProxyList([...proxyList, currentHost])
    onHostProxied?.(currentHost)
    await syncProxyIfActive().catch(() => undefined)
    return t('network.scenario.hostProxied', { host: currentHost })
  }

  return { proxied, toggle }
}

interface ScenarioRulesSectionProps {
  /** 当前站点（为空时不显示「当前站点走代理」按钮，如设置页） */
  currentHost: string
  disabled: boolean
  /** 当前站点加入代理列表后回调（父级据此把它移出绕过列表，绕过列表优先级更高） */
  onHostProxied: (host: string) => void
  /** 规则变化后刷新代理状态 */
  syncProxyIfActive: () => Promise<void>
}

/**
 * 自动模式的自定义规则：始终走代理的域名（补上规则列表未收录的站点），
 * 以及未命中任何规则时的去向。改动即时保存并重新应用代理。
 */
export default function ScenarioRulesSection({
  currentHost,
  disabled,
  onHostProxied,
  syncProxyIfActive,
}: ScenarioRulesSectionProps) {
  const [proxyList, setProxyList] = useStorageItem(networkScenarioProxyList)
  const [defaultAction, setDefaultAction] = useStorageItem(networkScenarioDefaultAction)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState('')

  // 未在编辑时跟随存储（其他页面或「当前站点直连」可能改动了列表）
  useEffect(() => {
    if (!editing) setText(proxyList.join('\n'))
  }, [proxyList, editing])

  const hostProxy = useScenarioHostProxy(currentHost, syncProxyIfActive, onHostProxied)

  const saveList = async (next: string[], message: string) => {
    setProxyList(next)
    setText(next.join('\n'))
    setStatus(message)
    await syncProxyIfActive().catch(() => undefined)
  }

  const commitText = () => {
    setEditing(false)
    const next = normalizeProxyList(text)
    if (next.join('\n') === proxyList.join('\n')) {
      setText(next.join('\n'))
      return
    }
    void saveList(next, t('network.scenario.saved', { count: next.length }))
  }

  const toggleCurrentHost = () => {
    void hostProxy.toggle().then(setStatus)
  }

  const changeDefaultAction = (value: string) => {
    const next = value as NetworkScenarioDefaultAction
    if (next === defaultAction) return
    setDefaultAction(next)
    setStatus(
      next === 'proxy'
        ? t('network.scenario.defaultAction.proxyStatus')
        : t('network.scenario.defaultAction.directStatus'),
    )
    void syncProxyIfActive().catch(() => undefined)
  }

  return (
    <div className='border-t border-neutral-100 pt-3'>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <div className='min-w-0'>
          <h3 className='text-xs font-semibold text-neutral-700'>{t('network.scenario.title')}</h3>
          <p className='truncate text-[10px] leading-4 text-neutral-500'>
            {t('network.scenario.desc')}
          </p>
        </div>
        {currentHost && (
          <Button
            disabled={disabled}
            onClick={toggleCurrentHost}
            className='shrink-0 !px-2 !py-1 text-xs'
          >
            {hostProxy.proxied ? t('network.scenario.unproxy') : t('network.scenario.proxyHost')}
          </Button>
        )}
      </div>
      <textarea
        value={text}
        rows={3}
        spellCheck={false}
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={commitText}
        placeholder={'npmjs.org\ncursor.com\n*.example.com'}
        className='w-full resize-none rounded-lg border border-neutral-300 bg-white px-2.5 py-2 font-mono text-xs leading-5 text-neutral-700 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500 disabled:opacity-60'
      />
      <p className='mt-1 text-[10px] leading-4 text-neutral-500'>{t('network.scenario.hint')}</p>

      <div className='mt-2.5 flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-xs font-medium text-neutral-700'>
            {t('network.scenario.defaultAction.title')}
          </p>
          <p className='text-[10px] leading-4 text-neutral-500'>
            {defaultAction === 'proxy'
              ? t('network.scenario.defaultAction.proxyHint')
              : t('network.scenario.defaultAction.directHint')}
          </p>
        </div>
        <Tabs
          value={defaultAction}
          tabs={getDefaultActionOptions()}
          onChange={changeDefaultAction}
        />
      </div>

      {status && <p className='mt-1.5 text-[10px] leading-4 text-neutral-500'>{status}</p>}
    </div>
  )
}
