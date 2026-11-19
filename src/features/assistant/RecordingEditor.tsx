/**
 * 录制：侧边栏「网页工具」页里开始 / 停止录制，录完后在这里整理成站点工具
 * （勾选哪些填写值做成参数、命名、是否只读），试运行后保存。
 */
import { Circle, Play, Square, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { parseSiteToolDraft, type SiteToolParam } from '@/features/site-tools/types'
import Button from '@/ui/Button'
import IconButton from '@/ui/IconButton'
import Switch from '@/ui/Switch'
import { t, type MessageKey } from '@/utils/i18n'
import {
  sendRuntimeMessage,
  type RecordedStep,
  type RecordingDraft,
  type WebmcpExecuteResult,
} from '@/utils/messaging'
import { siteRecordingDraft, siteRecordings, siteTools } from '@/utils/settings'

import { runSiteToolInTab, saveDraft } from './site-tools-client'

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/

const ACTION_LABELS: Record<RecordedStep['action'], MessageKey> = {
  click: 'assistant.recorder.action.click',
  fill: 'assistant.recorder.action.fill',
  press: 'assistant.recorder.action.press',
  wait: 'assistant.recorder.action.wait',
  read: 'assistant.recorder.action.read',
  fetch: 'assistant.recorder.action.fetch',
  navigate: 'assistant.recorder.action.navigate',
}

/** 当前标签页是否正在录制（录制状态存在后台的 session 存储里） */
export function useRecording(tabId: number | null): { recording: boolean; stepCount: number } {
  const [state, setState] = useState({ recording: false, stepCount: 0 })
  useEffect(() => {
    if (tabId == null) return undefined
    const apply = (all: Awaited<ReturnType<typeof siteRecordings.getValue>>) => {
      const current = all[String(tabId)]
      setState({ recording: Boolean(current), stepCount: current?.steps.length ?? 0 })
    }
    void siteRecordings.getValue().then(apply)
    return siteRecordings.watch(apply)
  }, [tabId])
  return state
}

export function useRecordingDraft(): RecordingDraft | null {
  const [draft, setDraft] = useState<RecordingDraft | null>(null)
  useEffect(() => {
    void siteRecordingDraft.getValue().then(setDraft)
    return siteRecordingDraft.watch(setDraft)
  }, [])
  return draft
}

/** 开始录制 / 录制中的提示条 */
export function RecorderControl({
  tabId,
  recording,
  stepCount,
}: {
  tabId: number | null
  recording: boolean
  stepCount: number
}) {
  const [error, setError] = useState('')

  const start = async () => {
    if (tabId == null) return
    setError('')
    const result = await sendRuntimeMessage({ type: 'site-recorder-start', tabId }).catch(
      (reason: unknown) => ({ ok: false, error: String(reason) }),
    )
    if (!result.ok) setError(result.error ?? t('assistant.recorder.startFailed'))
  }

  const stop = (cancel: boolean) => {
    if (tabId == null) return
    void sendRuntimeMessage({ type: 'site-recorder-finish', cancel, tabId })
  }

  if (recording) {
    return (
      <div className='flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-xs'>
        <p className='flex items-center gap-1.5 font-medium text-rose-700'>
          <Circle className='size-3 animate-pulse fill-current' aria-hidden />
          {t('assistant.recorder.recordingPanel', { count: stepCount })}
        </p>
        <p className='leading-relaxed text-neutral-600'>{t('assistant.recorder.recordingHint')}</p>
        <div className='flex justify-end gap-1.5'>
          <Button onClick={() => stop(true)} className='!px-3 !py-1 text-xs'>
            {t('assistant.recorder.cancel')}
          </Button>
          <Button variant='primary' onClick={() => stop(false)} className='!px-3 !py-1 text-xs'>
            <Square className='size-3' aria-hidden />
            {t('assistant.recorder.finish')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-1'>
      <Button
        onClick={() => void start()}
        block
        disabled={tabId == null}
        className='!py-1.5 text-xs'
      >
        <Circle className='size-3 fill-rose-500 text-rose-500' aria-hidden />
        {t('assistant.recorder.start')}
      </Button>
      {error && <p className='text-center text-[11px] text-rose-600'>{error}</p>}
    </div>
  )
}

interface ParamChoice {
  enabled: boolean
  name: string
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function stepSummary(step: RecordedStep): string {
  if (step.action === 'navigate') return step.url
  if (step.action === 'fetch') return step.url
  if (step.action === 'press') return step.note ? `${step.key} · ${step.note}` : step.key
  if (step.action === 'wait') return step.selector ?? `${step.ms ?? 0}ms`
  return step.note || step.selector
}

/** 录制完成后：整理成站点工具并保存 */
export function RecordingEditor({ draft, tabId }: { draft: RecordingDraft; tabId: number | null }) {
  const [steps, setSteps] = useState(draft.steps)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [matches, setMatches] = useState(hostOf(draft.startUrl))
  const [readOnly, setReadOnly] = useState(false)
  const [fromStart, setFromStart] = useState(false)
  const [params, setParams] = useState<Record<number, ParamChoice>>({})
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<WebmcpExecuteResult | null>(null)

  // 默认名称按已有工具数编号；密码框默认做成参数
  useEffect(() => {
    void siteTools.getValue().then((list) => setName(`recorded_flow_${list.length + 1}`))
    setDescription(
      t('assistant.recorder.defaultDescription', {
        title: draft.title || hostOf(draft.startUrl),
        count: draft.steps.length,
      }),
    )
    const initial: Record<number, ParamChoice> = {}
    let index = 0
    draft.steps.forEach((step, stepIndex) => {
      if (step.action !== 'fill') return
      index += 1
      initial[stepIndex] = {
        enabled: Boolean(step.password),
        name: step.password ? 'password' : `input${index}`,
      }
    })
    setParams(initial)
    setSteps(draft.steps)
  }, [draft])

  const removeStep = (index: number) => {
    setSteps((current) => current.filter((_step, stepIndex) => stepIndex !== index))
    setParams((current) => {
      const next: Record<number, ParamChoice> = {}
      for (const [key, value] of Object.entries(current)) {
        const stepIndex = Number(key)
        if (stepIndex < index) next[stepIndex] = value
        else if (stepIndex > index) next[stepIndex - 1] = value
      }
      return next
    })
  }

  const setFillValue = (index: number, value: string) =>
    setSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index && step.action === 'fill' ? { ...step, value } : step,
      ),
    )

  /** 生成工具定义；试运行时参数取录制时的值 */
  const build = () => {
    const toolParams: SiteToolParam[] = []
    const testArgs: Record<string, string> = {}
    const toolSteps = steps.map((step, index) => {
      // 去掉录制专用的 password 标记
      const { password: _password, ...rest } = step
      const choice = params[index]
      if (step.action !== 'fill' || !choice?.enabled) return rest
      if (!toolParams.some((param) => param.name === choice.name)) {
        toolParams.push({
          name: choice.name,
          description: step.password
            ? t('assistant.recorder.passwordParam')
            : t('assistant.recorder.inputParam', { field: step.note || choice.name }),
          type: 'string',
          required: true,
        })
      }
      if (!(step.password && step.value === '{{password}}')) testArgs[choice.name] = step.value
      return { ...rest, value: `{{${choice.name}}}` }
    })
    if (fromStart) toolSteps.unshift({ action: 'navigate', url: draft.startUrl })
    return {
      parsed: parseSiteToolDraft({
        name: name.trim(),
        description: description.trim(),
        matches: matches
          .split(/[\s,，]+/)
          .map((item) => item.trim())
          .filter(Boolean),
        readOnly,
        params: toolParams,
        steps: toolSteps,
      }),
      testArgs,
    }
  }

  const invalidParam = Object.entries(params).find(
    ([index, choice]) => choice.enabled && steps[Number(index)] && !NAME_PATTERN.test(choice.name),
  )

  const test = async () => {
    const { parsed, testArgs } = build()
    if (!parsed.ok) return setError(parsed.error)
    if (tabId == null) return
    setError('')
    setTesting(true)
    // 录完时网页通常停在流程的最后一页，从这里重放第一步会找不到元素：试运行总是先回到录制起点
    const testSteps =
      parsed.draft.steps[0]?.action === 'navigate'
        ? parsed.draft.steps
        : [{ action: 'navigate' as const, url: draft.startUrl }, ...parsed.draft.steps]
    setTestResult(await runSiteToolInTab(tabId, { steps: testSteps }, testArgs))
    setTesting(false)
  }

  const save = async () => {
    if (invalidParam) return setError(t('assistant.recorder.invalidParamName'))
    const { parsed } = build()
    if (!parsed.ok) return setError(parsed.error)
    await saveDraft(parsed.draft)
    await siteRecordingDraft.setValue(null)
  }

  const discard = () => void siteRecordingDraft.setValue(null)

  return (
    <div className='min-h-0 flex-1 overflow-y-auto px-3 py-3 text-xs'>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <p className='text-sm font-semibold text-neutral-900'>
          {t('assistant.recorder.editorTitle', { count: steps.length })}
        </p>
        <IconButton label={t('assistant.recorder.discard')} onClick={discard}>
          <X />
        </IconButton>
      </div>

      <div className='flex flex-col gap-2.5'>
        <Field label={t('assistant.recorder.name')} hint={t('assistant.recorder.nameHint')}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className='popup-field w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none'
          />
        </Field>
        <Field
          label={t('assistant.recorder.description')}
          hint={t('assistant.recorder.descriptionHint')}
        >
          <textarea
            value={description}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            className='popup-field w-full resize-y rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed outline-none'
          />
        </Field>
        <Field label={t('assistant.recorder.matches')} hint={t('assistant.recorder.matchesHint')}>
          <input
            value={matches}
            onChange={(event) => setMatches(event.target.value)}
            className='popup-field w-full rounded-lg border px-2.5 py-1.5 font-mono text-xs outline-none'
          />
        </Field>
        <Toggle
          label={t('assistant.recorder.readOnly')}
          hint={t('assistant.recorder.readOnlyHint')}
          checked={readOnly}
          onChange={setReadOnly}
        />
        <Toggle
          label={t('assistant.recorder.fromStart')}
          hint={t('assistant.recorder.fromStartHint', { url: draft.startUrl })}
          checked={fromStart}
          onChange={setFromStart}
        />
      </div>

      <p className='mt-4 mb-1.5 font-medium text-neutral-700'>{t('assistant.recorder.steps')}</p>
      <ol className='flex flex-col gap-1.5'>
        {steps.map((step, index) => {
          const choice = params[index]
          return (
            <li
              key={index}
              className='flex flex-col gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 py-2'
            >
              <div className='flex items-center gap-2'>
                <span className='w-4 shrink-0 text-right text-[11px] text-neutral-400'>
                  {index + 1}
                </span>
                <span className='shrink-0 rounded bg-black/5 px-1.5 text-[11px] text-neutral-700'>
                  {t(ACTION_LABELS[step.action])}
                </span>
                <span
                  className='min-w-0 flex-1 truncate text-neutral-600'
                  title={stepSummary(step)}
                >
                  {stepSummary(step)}
                </span>
                <IconButton
                  label={t('assistant.recorder.removeStep')}
                  onClick={() => removeStep(index)}
                  className='!size-6 hover:!text-rose-600 [&_svg]:!size-3.5'
                >
                  <Trash2 />
                </IconButton>
              </div>
              {step.action === 'fill' && (
                <div className='flex flex-col gap-1 pl-6'>
                  <input
                    type={step.password ? 'password' : 'text'}
                    value={step.value === '{{password}}' && step.password ? '' : step.value}
                    placeholder={step.password ? t('assistant.recorder.passwordNotRecorded') : ''}
                    onChange={(event) => setFillValue(index, event.target.value)}
                    className='popup-field w-full rounded-md border px-2 py-1 text-xs outline-none'
                  />
                  <label className='flex items-center gap-1.5 text-[11px] text-neutral-600'>
                    <input
                      type='checkbox'
                      checked={choice?.enabled ?? false}
                      onChange={(event) =>
                        setParams((current) => ({
                          ...current,
                          [index]: {
                            name: choice?.name ?? `input${index + 1}`,
                            enabled: event.target.checked,
                          },
                        }))
                      }
                    />
                    {t('assistant.recorder.asParam')}
                    {choice?.enabled && (
                      <input
                        value={choice.name}
                        onChange={(event) =>
                          setParams((current) => ({
                            ...current,
                            [index]: { enabled: true, name: event.target.value },
                          }))
                        }
                        className={`popup-field ml-1 w-28 rounded border px-1.5 py-0.5 font-mono text-[11px] outline-none ${
                          NAME_PATTERN.test(choice.name) ? '' : '!border-rose-400'
                        }`}
                      />
                    )}
                  </label>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <p className='mt-3 text-[11px] leading-relaxed text-neutral-500'>
        {t('assistant.recorder.testHint')}
      </p>
      {testResult && (
        <pre
          className={`mt-3 max-h-48 overflow-auto rounded-lg p-2 font-mono text-[11px] whitespace-pre-wrap break-all ${
            testResult.ok ? 'bg-black/[0.04] text-neutral-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {testResult.ok ? testResult.result : testResult.error}
        </pre>
      )}
      {error && <p className='mt-3 text-rose-600'>{error}</p>}

      <div className='mt-3 flex items-center justify-end gap-1.5'>
        <Button onClick={discard} className='!px-3 !py-1 text-xs'>
          {t('assistant.recorder.discard')}
        </Button>
        <Button
          onClick={() => void test()}
          loading={testing}
          disabled={tabId == null}
          className='!px-3 !py-1 text-xs'
        >
          <Play className='size-3' aria-hidden />
          {t('assistant.recorder.test')}
        </Button>
        <Button variant='primary' onClick={() => void save()} className='!px-3 !py-1 text-xs'>
          {t('assistant.recorder.save')}
        </Button>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className='flex flex-col gap-1'>
      <span className='font-medium text-neutral-700'>{label}</span>
      {children}
      {hint && <span className='text-[11px] leading-relaxed text-neutral-500'>{hint}</span>}
    </label>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='min-w-0'>
        <p className='font-medium text-neutral-700'>{label}</p>
        <p className='text-[11px] leading-relaxed break-all text-neutral-500'>{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  )
}
