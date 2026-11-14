import { useEffect, useState } from 'react'

import { isLlmUsable } from '@/features/translate/llm-config'
import { TARGET_LANGUAGE_OPTIONS } from '@/features/translate/languages'
import { PROVIDER_OPTIONS } from '@/features/translate/ui-options'
import { t } from '@/utils/i18n'
import { sendTabRequest } from '@/utils/messaging'
import {
  translateAutoHosts,
  translateLlmApiKey,
  translateLlmConfig,
  translateProvider,
  translateTargetLang,
  type TranslateProvider,
} from '@/utils/settings'
import type { TranslateTargetSetting } from '@/features/translate/languages'
import { useStorageItem } from '@/utils/useStorageItem'
import Button from '@/ui/Button'
import Select from '@/ui/Select'
import Switch from '@/ui/Switch'
import { formatShortcut, openShortcutSettings } from '@/utils/shortcut'
import { useCommandShortcuts } from '@/utils/useCommandShortcuts'
import { getActiveHostname } from '@/utils/tabs'
import { ArrowUpRight } from 'lucide-react'

/** 打开设置页的指定分区（如 #translate、#models），并关闭 popup */
function openOptionsSection(section: string) {
  void browser.tabs
    .create({ url: browser.runtime.getURL(`/options.html#${section}`) })
    .finally(() => window.close())
}

/** popup「翻译」页的整页翻译面板 */
export default function PageTranslatePanel() {
  const [provider, setProvider] = useStorageItem(translateProvider)
  const [target, setTarget] = useStorageItem(translateTargetLang)
  const [autoHosts, setAutoHosts] = useStorageItem(translateAutoHosts)
  const [llmConfig] = useStorageItem(translateLlmConfig)
  const [llmApiKey] = useStorageItem(translateLlmApiKey)

  const [hostname, setHostname] = useState('')
  /** null：当前页面无法注入内容脚本（浏览器内置页、扩展商店等） */
  const [pageActive, setPageActive] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  /** 整页翻译命令当前绑定的快捷键（Chrome 最多预设 4 个默认快捷键，此命令默认不带键） */
  const shortcut = useCommandShortcuts()['inline-translate'] ?? ''

  useEffect(() => {
    getActiveHostname().then(setHostname)
    sendTabRequest({ type: 'get-page-translation-state' }).then((state) => {
      setPageActive(state ? state.active : null)
    })
  }, [])

  const llmMissing = provider === 'llm' && !isLlmUsable(llmConfig, llmApiKey)
  const alwaysTranslate = Boolean(hostname) && autoHosts.includes(hostname)
  const unsupported = pageActive === null

  const togglePage = async () => {
    setBusy(true)
    const state = await sendTabRequest({ type: 'translate-page' })
    setPageActive(state ? state.active : null)
    setBusy(false)
  }

  const toggleAlwaysTranslate = async (checked: boolean) => {
    if (!hostname) return
    setAutoHosts(
      checked ? [...new Set([...autoHosts, hostname])] : autoHosts.filter((h) => h !== hostname),
    )
    if (checked && !pageActive) {
      const state = await sendTabRequest({ type: 'set-page-translation', enabled: true })
      setPageActive(state ? state.active : null)
    }
  }

  return (
    <section className='flex flex-col gap-2.5 rounded-lg border border-neutral-200 bg-white p-3'>
      <div className='flex items-center justify-between'>
        <span className='text-sm font-medium text-neutral-800'>
          {t('popup.pageTranslate.title')}
        </span>
        <button
          type='button'
          onClick={() => openOptionsSection('translate')}
          className='text-xs text-neutral-500 transition-colors hover:text-accent-600'
        >
          {t('popup.pageTranslate.moreSettings')}
          <ArrowUpRight className='ml-0.5 inline size-3 -translate-y-px' aria-hidden />
        </button>
      </div>

      <div className='grid grid-cols-2 gap-2'>
        <label className='flex flex-col gap-1'>
          <span className='text-[11px] text-neutral-500'>{t('popup.pageTranslate.engine')}</span>
          <Select
            value={provider}
            options={PROVIDER_OPTIONS}
            onChange={(value) => setProvider(value as TranslateProvider)}
          />
        </label>
        <label className='flex flex-col gap-1'>
          <span className='text-[11px] text-neutral-500'>
            {t('popup.pageTranslate.targetLang')}
          </span>
          <Select
            value={target}
            options={TARGET_LANGUAGE_OPTIONS}
            onChange={(value) => setTarget(value as TranslateTargetSetting)}
          />
        </label>
      </div>

      {provider === 'llm' && (
        <button
          type='button'
          onClick={() => openOptionsSection('models')}
          className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
            llmMissing
              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'bg-accent-50/60 text-neutral-500 hover:bg-accent-50'
          }`}
        >
          <span className='truncate'>
            {llmMissing
              ? t('popup.pageTranslate.llmMissing')
              : t('popup.pageTranslate.llmModel', { model: llmConfig.model })}
          </span>
          <span className='shrink-0 text-accent-600'>
            {llmMissing ? t('popup.pageTranslate.configure') : t('popup.pageTranslate.change')}
            <ArrowUpRight className='ml-0.5 inline size-3 -translate-y-px' aria-hidden />
          </span>
        </button>
      )}

      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 flex-col'>
          <span className='text-xs text-neutral-500'>
            {t('popup.pageTranslate.alwaysTranslate')}
          </span>
          <span className='truncate text-[11px] text-neutral-500'>
            {hostname || t('popup.common.pageUnsupported')}
          </span>
        </div>
        <Switch
          checked={alwaysTranslate}
          disabled={!hostname}
          onChange={(checked) => void toggleAlwaysTranslate(checked)}
        />
      </div>

      <Button
        variant='primary'
        block
        loading={busy}
        disabled={unsupported || llmMissing}
        onClick={() => void togglePage()}
      >
        {pageActive
          ? t('popup.pageTranslate.showOriginal')
          : t('popup.pageTranslate.translatePage')}
        {shortcut && (
          <kbd className='ml-1.5 font-sans text-xs opacity-75'>{formatShortcut(shortcut)}</kbd>
        )}
      </Button>
      <p className='text-left text-[11px] leading-snug text-neutral-500'>
        {unsupported ? (
          t('popup.pageTranslate.unsupported')
        ) : shortcut ? (
          t('popup.pageTranslate.hintWithShortcut', { shortcut: formatShortcut(shortcut) })
        ) : (
          <>
            {t('popup.pageTranslate.hintNoShortcut')}{' '}
            <button
              type='button'
              onClick={() => void openShortcutSettings().finally(() => window.close())}
              className='text-accent-500 hover:underline'
            >
              {t('popup.pageTranslate.setShortcut')}
              <ArrowUpRight className='ml-0.5 inline size-3 -translate-y-px' aria-hidden />
            </button>
          </>
        )}
      </p>
    </section>
  )
}
