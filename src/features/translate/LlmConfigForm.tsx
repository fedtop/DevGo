import { useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  findPresetByBaseUrl,
  getLlmPreset,
  isLlmConfigReady,
  requiresApiKey,
  LLM_PRESETS,
  type LlmConfig,
} from '@/features/translate/llm-config'
import { describeServiceError } from '@/features/translate/errors'
import { t } from '@/utils/i18n'
import {
  sendRuntimeMessage,
  type LlmModelListResult,
  type TranslateTestResult,
} from '@/utils/messaging'
import {
  assistantLlmApiKey,
  assistantLlmConfig,
  translateLlmApiKey,
  translateLlmConfig,
  translateProvider,
} from '@/utils/settings'
import { useStorageItem } from '@/utils/useStorageItem'
import Button from '@/ui/Button'
import Combobox, { type ComboboxOption } from '@/ui/Combobox'
import Select from '@/ui/Select'

interface RemoteModels {
  /** 拉取时使用的「地址 + Key」，变化后需要重新拉取 */
  source: string
  status: 'loading' | 'done' | 'error'
  models: string[]
  error?: LlmModelListResult['error']
}

interface LlmConfigFormProps {
  /** 紧凑布局（popup 内使用）：更小的字号，自定义要求默认折叠 */
  compact?: boolean
  /** 保存成功后回调（popup 用来收起表单） */
  onSaved?: () => void
  /**
   * 配置用途：translate 为 AI 翻译（保存时可设为翻译引擎）；
   * assistant 为对话模型（划词 AI、侧边栏助手；独立存储，未保存过时用翻译配置预填，测试会校验工具调用能力）
   */
  target?: 'translate' | 'assistant'
}

function Field({
  label,
  hint,
  compact,
  children,
}: {
  label: string
  hint?: ReactNode
  compact?: boolean
  children: ReactNode
}) {
  return (
    <label className={`flex flex-col ${compact ? 'gap-1' : 'gap-1.5'}`}>
      <span className={compact ? 'text-[11px] text-neutral-500' : 'text-sm text-neutral-700'}>
        {label}
      </span>
      {children}
      {hint && (
        <span className={`leading-relaxed text-neutral-500 ${compact ? 'text-[11px]' : 'text-xs'}`}>
          {hint}
        </span>
      )}
    </label>
  )
}

/**
 * AI 翻译（OpenAI 兼容接口）配置表单：popup 翻译面板与选项页共用。
 * 编辑的是本地草稿，点击保存才写入存储 —— 避免每次按键都让已打开的页面重启翻译。
 */
export default function LlmConfigForm({
  compact = false,
  onSaved,
  target = 'translate',
}: LlmConfigFormProps) {
  const forAssistant = target === 'assistant'
  const [translateConfig, setTranslateConfig, translateConfigLoaded] =
    useStorageItem(translateLlmConfig)
  const [translateKey, setTranslateKey, translateKeyLoaded] = useStorageItem(translateLlmApiKey)
  const [assistantConfig, setAssistantConfig, assistantConfigLoaded] =
    useStorageItem(assistantLlmConfig)
  const [assistantKey, setAssistantKey, assistantKeyLoaded] = useStorageItem(assistantLlmApiKey)
  const [provider, setProvider] = useStorageItem(translateProvider)

  /** 助手从未保存过配置时，用翻译的 AI 配置预填（同一个服务商通常两边都能用） */
  const assistantPrefilled = forAssistant && assistantConfigLoaded && assistantConfig === null
  const savedConfig = forAssistant ? (assistantConfig ?? translateConfig) : translateConfig
  const savedKey = forAssistant ? (assistantPrefilled ? translateKey : assistantKey) : translateKey
  const configLoaded = forAssistant
    ? assistantConfigLoaded && translateConfigLoaded
    : translateConfigLoaded
  const keyLoaded = forAssistant ? assistantKeyLoaded && translateKeyLoaded : translateKeyLoaded

  const [draft, setDraft] = useState<LlmConfig>(savedConfig)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [showPrompt, setShowPrompt] = useState(!compact)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TranslateTestResult | null>(null)
  const [savedTip, setSavedTip] = useState('')

  useEffect(() => {
    if (!configLoaded) return
    setDraft(savedConfig)
    if (savedConfig.prompt) setShowPrompt(true)
  }, [configLoaded, savedConfig])

  useEffect(() => {
    if (keyLoaded) setApiKey(savedKey)
  }, [keyLoaded, savedKey])

  const [remote, setRemote] = useState<RemoteModels | null>(null)

  const preset = getLlmPreset(draft.preset)
  const matchedPreset = preset?.id === 'custom' ? findPresetByBaseUrl(draft.baseUrl) : preset
  const ready = isLlmConfigReady(draft)
  const modelSource = `${draft.baseUrl.trim()}\u0000${apiKey.trim()}`

  /** 模型下拉：服务端实时列表为主（常用模型排前并标注），拉取失败时用预设候选兜底 */
  const modelOptions = useMemo<ComboboxOption[]>(() => {
    const common = matchedPreset?.models ?? []
    const fetched = remote?.source === modelSource ? remote.models : []
    const ordered = [...common.filter((id) => !fetched.length || fetched.includes(id))]
    fetched.forEach((id) => {
      if (!ordered.includes(id)) ordered.push(id)
    })
    return ordered.map((id) => ({
      value: id,
      note: common.includes(id) ? t('translate.llmForm.commonModel') : undefined,
    }))
  }, [matchedPreset, remote, modelSource])

  /** 远程服务没填 Key 时不发请求：必然鉴权失败，直接提示先填 Key */
  const missingKey = requiresApiKey(draft.baseUrl) && !apiKey.trim()

  const loadModels = async () => {
    if (!draft.baseUrl.trim() || missingKey) return
    if (remote?.source === modelSource && remote.status !== 'error') return

    const source = modelSource
    setRemote({ source, status: 'loading', models: [] })
    const result = await sendRuntimeMessage({
      type: 'list-llm-models',
      baseUrl: draft.baseUrl,
      apiKey: apiKey.trim(),
    })
    setRemote((current) =>
      current?.source === source
        ? {
            source,
            status: result.error ? 'error' : 'done',
            models: result.models,
            error: result.error,
          }
        : current,
    )
  }

  const modelStatus = ((): ReactNode => {
    const fallback = modelOptions.length
      ? t('translate.llmForm.models.fallbackCommon')
      : t('translate.llmForm.models.fallbackInput')
    if (!draft.baseUrl.trim()) return t('translate.llmForm.models.needBaseUrl')
    if (missingKey) return t('translate.llmForm.models.needApiKey', { fallback })
    if (remote?.source !== modelSource) return undefined
    if (remote.status === 'loading') return t('translate.llmForm.models.loading')
    if (remote.status === 'error' && remote.error) {
      return (
        <span title={remote.error.message} className='text-amber-600'>
          {remote.error.code === 'config'
            ? t('translate.llmForm.models.unsupported', { fallback })
            : t('translate.llmForm.models.failed', {
                reason: describeServiceError(remote.error.code),
                fallback,
              })}
        </span>
      )
    }
    return remote.models.length
      ? t('translate.llmForm.models.count', { count: remote.models.length })
      : undefined
  })()
  const dirty =
    assistantPrefilled ||
    JSON.stringify(draft) !== JSON.stringify(savedConfig) ||
    apiKey !== savedKey
  // 助手配置与翻译引擎无关，视作「已生效」，按钮只显示「保存」
  const isActiveEngine = forAssistant || provider === 'llm'

  const resetFeedback = () => {
    setTestResult(null)
    setSavedTip('')
  }

  const update = (patch: Partial<LlmConfig>) => {
    setDraft((current) => ({ ...current, ...patch }))
    resetFeedback()
  }

  const choosePreset = (id: string) => {
    const next = getLlmPreset(id)
    if (!next) return
    update(
      id === 'custom' ? { preset: id } : { preset: id, baseUrl: next.baseUrl, model: next.model },
    )
  }

  const save = () => {
    const nextConfig = { ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim() }
    if (forAssistant) {
      setAssistantConfig(nextConfig)
      setAssistantKey(apiKey.trim())
      setSavedTip(t('translate.llmForm.saved'))
      onSaved?.()
      return
    }
    setTranslateConfig(nextConfig)
    setTranslateKey(apiKey.trim())
    if (!isActiveEngine) setProvider('llm')
    setSavedTip(isActiveEngine ? t('translate.llmForm.saved') : t('translate.llmForm.savedAndUsed'))
    onSaved?.()
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    const result = forAssistant
      ? await sendRuntimeMessage({ type: 'test-assistant', llm: draft, apiKey: apiKey.trim() })
      : await sendRuntimeMessage({
          type: 'test-translate',
          provider: 'llm',
          llm: draft,
          apiKey: apiKey.trim(),
        })
    setTestResult(result)
    setTesting(false)
  }

  const inputClass = `popup-field w-full rounded-lg border text-neutral-700 outline-none transition-colors placeholder:text-neutral-400 ${
    compact ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-2 text-sm'
  }`
  const buttonClass = compact ? '!px-2.5 !py-1 text-xs' : ''

  return (
    <div className={`flex flex-col ${compact ? 'gap-2.5' : 'gap-4'}`}>
      <div className={compact ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-4'}>
        <Field label={t('translate.llmForm.preset')} compact={compact}>
          <Select
            value={draft.preset}
            options={LLM_PRESETS.map((item) => ({ value: item.id, label: item.label }))}
            onChange={choosePreset}
          />
        </Field>
        <Field label={t('translate.llmForm.model')} compact={compact}>
          <Combobox
            value={draft.model}
            options={modelOptions}
            status={modelStatus}
            placeholder={t('translate.llmForm.modelPlaceholder')}
            onOpen={() => void loadModels()}
            onChange={(model) => update({ model })}
            inputClassName={compact ? 'py-1.5 pl-2.5 text-[13px]' : 'py-2 pl-3 text-sm'}
          />
        </Field>
      </div>

      {matchedPreset?.hint && (
        <p className={`leading-relaxed text-amber-600 ${compact ? 'text-[11px]' : 'text-xs'}`}>
          {matchedPreset.hint}
        </p>
      )}

      <Field
        label={t('translate.llmForm.baseUrl')}
        compact={compact}
        hint={compact ? undefined : t('translate.llmForm.baseUrlHint')}
      >
        <input
          className={inputClass}
          value={draft.baseUrl}
          placeholder='https://api.openai.com/v1'
          spellCheck={false}
          onChange={(e) =>
            update({
              baseUrl: e.target.value,
              preset: findPresetByBaseUrl(e.target.value)?.id ?? 'custom',
            })
          }
        />
      </Field>

      <Field label={t('translate.llmForm.apiKey')} compact={compact}>
        <div className='flex gap-2'>
          <input
            className={inputClass}
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            placeholder={t('translate.llmForm.apiKeyPlaceholder')}
            autoComplete='off'
            spellCheck={false}
            onChange={(e) => {
              setApiKey(e.target.value)
              resetFeedback()
            }}
          />
          <Button onClick={() => setShowKey((v) => !v)} className={`shrink-0 ${buttonClass}`}>
            {showKey ? t('translate.llmForm.hideKey') : t('translate.llmForm.showKey')}
          </Button>
        </div>
      </Field>

      {assistantPrefilled && (
        <p className={`leading-relaxed text-neutral-500 ${compact ? 'text-[11px]' : 'text-xs'}`}>
          {t('translate.llmForm.assistantPrefilled')}
        </p>
      )}

      {showPrompt ? (
        <Field
          label={t('translate.llmForm.prompt')}
          compact={compact}
          hint={
            forAssistant
              ? t('translate.llmForm.promptHintAssistant')
              : t('translate.llmForm.promptHintTranslate')
          }
        >
          <textarea
            className={`${inputClass} resize-y ${compact ? 'min-h-14' : 'min-h-20'}`}
            value={draft.prompt}
            onChange={(e) => update({ prompt: e.target.value })}
          />
        </Field>
      ) : (
        <button
          type='button'
          onClick={() => setShowPrompt(true)}
          className='self-start text-[11px] text-neutral-500 transition-colors hover:text-accent-600'
        >
          {forAssistant
            ? t('translate.llmForm.addPromptAssistant')
            : t('translate.llmForm.addPromptTranslate')}
        </button>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          onClick={() => void test()}
          loading={testing}
          disabled={!ready}
          className={buttonClass}
        >
          {t('translate.llmForm.test')}
        </Button>
        <Button
          variant='primary'
          onClick={save}
          disabled={!ready || (!dirty && isActiveEngine)}
          className={buttonClass}
        >
          {isActiveEngine ? t('translate.llmForm.save') : t('translate.llmForm.saveAndUse')}
        </Button>
        {savedTip && <span className='text-xs text-emerald-600'>{savedTip}</span>}
      </div>

      {testResult && (
        <div
          className={`rounded-lg px-2.5 py-1.5 text-xs leading-relaxed ${
            !testResult.ok
              ? 'bg-rose-50 text-rose-700'
              : testResult.warning
                ? 'bg-amber-50 text-amber-700'
                : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {testResult.ok ? (
            forAssistant ? (
              testResult.sample
            ) : (
              t('translate.llmForm.testSuccess', { sample: testResult.sample ?? '' })
            )
          ) : (
            <span title={testResult.error?.message}>
              {t(
                testResult.error?.code === 'auth'
                  ? 'translate.llmForm.testFailedAuth'
                  : 'translate.llmForm.testFailed',
                {
                  reason: testResult.error
                    ? describeServiceError(testResult.error.code)
                    : t('translate.errors.unknown'),
                },
              )}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
