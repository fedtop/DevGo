import { useState } from 'react'

import { TARGET_LANGUAGE_OPTIONS } from '@/features/translate/languages'
import type { TranslateTargetSetting } from '@/features/translate/languages'
import {
  describeHoverMode,
  DISPLAY_MODE_OPTIONS,
  HOVER_MODE_OPTIONS,
  PROVIDER_OPTIONS,
} from '@/features/translate/ui-options'
import { isLlmConfigReady } from '@/features/translate/llm-config'
import {
  hoverTranslateMode,
  translateLlmConfig,
  translateAutoHosts,
  translateDisplayMode,
  translateProvider,
  translateTargetLang,
  translateUnderline,
  type HoverTranslateMode,
  type TranslateDisplayMode,
  type TranslateProvider,
} from '@/utils/settings'
import { t } from '@/utils/i18n'
import { useStorageItem } from '@/utils/useStorageItem'
import Button from '@/ui/Button'
import Select from '@/ui/Select'
import Switch from '@/ui/Switch'
import Tabs from '@/ui/Tabs'

import { Card, INPUT_CLASS, Row, SectionHeader } from './layout'
import { ArrowRight, X } from 'lucide-react'

/** 跳到「AI 模型」分区 */
function ModelLink({ label }: { label: string }) {
  return (
    <a href='#models' className='ml-1.5 text-accent-600 hover:underline'>
      {label}
      <ArrowRight className='ml-0.5 inline size-3 -translate-y-px' aria-hidden />
    </a>
  )
}

function GeneralSettings() {
  const [provider, setProvider] = useStorageItem(translateProvider)
  const [target, setTarget] = useStorageItem(translateTargetLang)
  const [displayMode, setDisplayMode] = useStorageItem(translateDisplayMode)
  const [underline, setUnderline] = useStorageItem(translateUnderline)
  const [hoverMode, setHoverMode] = useStorageItem(hoverTranslateMode)
  const [llmConfig] = useStorageItem(translateLlmConfig)
  const llmReady = isLlmConfigReady(llmConfig)

  return (
    <Card title={t('options.translate.page.title')} desc={t('options.translate.page.desc')}>
      <Row
        label={t('options.translate.page.provider')}
        hint={
          provider === 'llm' ? (
            <>
              {llmReady ? (
                t('options.translate.page.usingModel', { model: llmConfig.model })
              ) : (
                <span className='text-amber-600'>{t('options.translate.page.modelMissing')}</span>
              )}
              <ModelLink
                label={
                  llmReady
                    ? t('options.translate.page.editModel')
                    : t('options.translate.page.configureModel')
                }
              />
            </>
          ) : (
            <>
              {t('options.translate.page.freeHint')}
              <ModelLink label={t('options.translate.page.configureAiModel')} />
            </>
          )
        }
      >
        <Select
          value={provider}
          options={PROVIDER_OPTIONS}
          onChange={(value) => setProvider(value as TranslateProvider)}
          className='w-56'
        />
      </Row>
      <Row label={t('options.translate.page.target')} hint={t('options.translate.page.targetHint')}>
        <Select
          value={target}
          options={TARGET_LANGUAGE_OPTIONS}
          onChange={(value) => setTarget(value as TranslateTargetSetting)}
          className='w-56'
        />
      </Row>
      <Row
        label={t('options.translate.page.displayMode')}
        hint={t('options.translate.page.displayModeHint')}
      >
        <Tabs
          value={displayMode}
          tabs={DISPLAY_MODE_OPTIONS}
          onChange={(value) => setDisplayMode(value as TranslateDisplayMode)}
        />
      </Row>
      <Row
        label={t('options.translate.page.underline')}
        hint={t('options.translate.page.underlineHint')}
      >
        <Switch checked={underline} onChange={setUnderline} />
      </Row>
      <Row label={t('options.translate.page.hover')} hint={describeHoverMode(hoverMode)}>
        <Select
          value={hoverMode}
          options={HOVER_MODE_OPTIONS}
          onChange={(value) => setHoverMode(value as HoverTranslateMode)}
          className='w-56'
        />
      </Row>
    </Card>
  )
}

function AutoHostsSettings() {
  const [hosts, setHosts] = useStorageItem(translateAutoHosts)
  const [input, setInput] = useState('')

  const add = () => {
    const raw = input.trim()
    if (!raw) return
    let host = raw
    try {
      host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
    } catch {
      return
    }
    setHosts([...new Set([...hosts, host])])
    setInput('')
  }

  return (
    <Card
      title={t('options.translate.autoHosts.title')}
      desc={t('options.translate.autoHosts.desc')}
    >
      <div className='flex gap-2'>
        <input
          className={INPUT_CLASS}
          value={input}
          placeholder={t('options.translate.autoHosts.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
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
              className='flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 py-1 pl-3 pr-1.5 text-xs text-neutral-600'
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
  )
}

/** 设置页：翻译 */
export default function TranslateSettings() {
  return (
    <div className='flex flex-col gap-5'>
      <SectionHeader title={t('options.translate.title')} desc={t('options.translate.desc')} />
      <GeneralSettings />
      <AutoHostsSettings />
    </div>
  )
}
