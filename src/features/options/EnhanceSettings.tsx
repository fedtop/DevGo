import { useState } from 'react'

import Button from '@/ui/Button'
import Switch from '@/ui/Switch'
import { t } from '@/utils/i18n'
import { dockDisabledHosts, dockEnabled, enableGithubEnhance, unlockHosts } from '@/utils/settings'
import { useStorageItem } from '@/utils/useStorageItem'

import { Card, INPUT_CLASS, Row, SectionHeader } from './layout'
import { X } from 'lucide-react'

/** 设置页：网页增强 */
export default function EnhanceSettings() {
  const [githubOn, setGithubOn] = useStorageItem(enableGithubEnhance)
  const [hosts, setHosts] = useStorageItem(unlockHosts)
  const [input, setInput] = useState('')
  const [dockOn, setDockOn] = useStorageItem(dockEnabled)
  const [dockHosts, setDockHosts] = useStorageItem(dockDisabledHosts)

  const add = () => {
    const raw = input.trim()
    if (!raw) return
    try {
      const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
      setHosts([...new Set([...hosts, host])])
      setInput('')
    } catch {
      // 无法解析的输入不添加
    }
  }

  return (
    <div className='flex flex-col gap-5'>
      <SectionHeader title={t('options.enhance.title')} desc={t('options.enhance.desc')} />

      <Card title={t('options.enhance.dock.title')} desc={t('options.enhance.dock.desc')}>
        <Row label={t('options.enhance.dock.label')} hint={t('options.enhance.dock.hint')}>
          <Switch checked={dockOn} onChange={setDockOn} />
        </Row>
        <div>
          <p className='mb-2 text-xs text-neutral-500'>{t('options.enhance.dock.disabledHosts')}</p>
          {dockHosts.length > 0 ? (
            <ul className='flex flex-wrap gap-2'>
              {dockHosts.map((host) => (
                <li
                  key={host}
                  className='flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 py-1 pr-1.5 pl-3 text-xs text-neutral-600'
                >
                  {host}
                  <button
                    type='button'
                    aria-label={t('options.hostList.remove', { host })}
                    onClick={() => setDockHosts(dockHosts.filter((item) => item !== host))}
                    className='flex h-4 w-4 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-600'
                  >
                    <X className='size-3' aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-xs text-neutral-500'>{t('options.hostList.empty')}</p>
          )}
        </div>
      </Card>

      <Card title='GitHub'>
        <Row label={t('options.enhance.github.label')} hint={t('options.enhance.github.hint')}>
          <Switch checked={githubOn} onChange={setGithubOn} />
        </Row>
      </Card>

      <Card title={t('options.enhance.unlock.title')} desc={t('options.enhance.unlock.desc')}>
        <div className='flex gap-2'>
          <input
            className={INPUT_CLASS}
            value={input}
            placeholder={t('options.enhance.unlock.placeholder')}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && add()}
          />
          <Button onClick={add} className='shrink-0'>
            {t('options.hostList.add')}
          </Button>
        </div>
        {hosts.length > 0 ? (
          <ul className='flex flex-wrap gap-2'>
            {hosts.map((host) => (
              <li
                key={host}
                className='flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 py-1 pr-1.5 pl-3 text-xs text-neutral-600'
              >
                {host}
                <button
                  type='button'
                  aria-label={t('options.hostList.remove', { host })}
                  onClick={() => setHosts(hosts.filter((item) => item !== host))}
                  className='flex h-4 w-4 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-600'
                >
                  <X className='size-3' aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-xs text-neutral-500'>{t('options.hostList.empty')}</p>
        )}
      </Card>
    </div>
  )
}
