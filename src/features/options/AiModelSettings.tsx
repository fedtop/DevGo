import { useState, type ReactNode } from 'react'

import { resolveChatModel } from '@/features/ai/model'
import {
  findPresetByBaseUrl,
  getLlmPreset,
  isLlmConfigReady,
  requiresApiKey,
  type LlmConfig,
} from '@/features/translate/llm-config'
import LlmConfigForm from '@/features/translate/LlmConfigForm'
import Button from '@/ui/Button'
import { t } from '@/utils/i18n'
import {
  assistantLlmApiKey,
  assistantLlmConfig,
  translateLlmApiKey,
  translateLlmConfig,
} from '@/utils/settings'
import { useStorageItem } from '@/utils/useStorageItem'

import { SectionHeader } from './layout'
import { ChevronDown } from 'lucide-react'

/** 当前配置的一行摘要：服务 · 模型 · Key 状态 */
function ConfigSummary({ config, apiKey }: { config: LlmConfig; apiKey: string }) {
  if (!isLlmConfigReady(config)) {
    return <span className='text-amber-600'>{t('options.models.notConfigured')}</span>
  }
  const preset = getLlmPreset(config.preset)
  const service = (preset?.id === 'custom' ? findPresetByBaseUrl(config.baseUrl) : preset)?.label
  const missingKey = requiresApiKey(config.baseUrl) && !apiKey.trim()

  return (
    <span className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
      {service && <span>{service}</span>}
      <span className='rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px] text-neutral-700'>
        {config.model}
      </span>
      {missingKey && <span className='text-amber-600'>{t('options.models.missingKey')}</span>}
    </span>
  )
}

function ModelCard({
  title,
  badge,
  desc,
  summary,
  children,
}: {
  title: string
  badge: { text: string; tone: 'fast' | 'smart' }
  desc: ReactNode
  summary: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <section
      className={`rounded-xl border bg-white transition-colors ${
        open ? 'border-accent-200' : 'border-neutral-200'
      }`}
    >
      <div className='flex items-start justify-between gap-4 p-5'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <h2 className='text-base font-semibold text-neutral-800'>{title}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                badge.tone === 'fast'
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-accent-50 text-accent-600'
              }`}
            >
              {badge.text}
            </span>
          </div>
          <p className='mt-1 text-xs leading-relaxed text-neutral-500'>{desc}</p>
          <div className='mt-2.5 text-sm text-neutral-500'>{summary}</div>
        </div>
        <Button
          variant={open ? 'default' : 'primary'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className='shrink-0 !px-3.5 !py-1.5 text-sm'
        >
          {open ? t('options.models.collapse') : t('options.models.configure')}
          <ChevronDown
            className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </Button>
      </div>
      {open && <div className='border-t border-neutral-100 px-5 pt-4 pb-5'>{children}</div>}
    </section>
  )
}

/** 设置页：AI 模型（翻译模型与对话模型分开配置） */
export default function AiModelSettings() {
  const [translateConfig] = useStorageItem(translateLlmConfig)
  const [translateKey] = useStorageItem(translateLlmApiKey)
  const [assistantConfig, setAssistantConfig] = useStorageItem(assistantLlmConfig)
  const [assistantKey, setAssistantKey] = useStorageItem(assistantLlmApiKey)
  const chatModel = resolveChatModel(assistantConfig, assistantKey, translateConfig, translateKey)

  return (
    <div className='flex flex-col gap-5'>
      <SectionHeader title={t('options.models.title')} desc={t('options.models.desc')} />

      <ModelCard
        title={t('options.models.translateModel.title')}
        badge={{ text: t('options.models.translateModel.badge'), tone: 'fast' }}
        desc={t('options.models.translateModel.desc')}
        summary={<ConfigSummary config={translateConfig} apiKey={translateKey} />}
      >
        <LlmConfigForm />
      </ModelCard>

      <ModelCard
        title={t('options.models.chatModel.title')}
        badge={{ text: t('options.models.chatModel.badge'), tone: 'smart' }}
        desc={t('options.models.chatModel.desc')}
        summary={
          <span className='flex flex-wrap items-center gap-x-2'>
            <ConfigSummary config={chatModel.config} apiKey={chatModel.apiKey} />
            {chatModel.inherited && (
              <span className='text-neutral-500'>{t('options.models.chatModel.inherited')}</span>
            )}
          </span>
        }
      >
        <div className='flex flex-col gap-4'>
          <LlmConfigForm target='assistant' />
          {!chatModel.inherited && (
            <div className='flex items-center justify-between gap-4 border-t border-neutral-100 pt-3'>
              <span className='text-xs text-neutral-500'>
                {t('options.models.chatModel.resetHint')}
              </span>
              <Button
                onClick={() => {
                  setAssistantConfig(null)
                  setAssistantKey('')
                }}
                className='shrink-0 !px-2.5 !py-1 text-xs'
              >
                {t('options.models.chatModel.reset')}
              </Button>
            </div>
          )}
        </div>
      </ModelCard>
    </div>
  )
}
