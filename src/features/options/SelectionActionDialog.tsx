import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

import {
  ACTION_ICONS,
  scopeLabel,
  SELECTION_ACTION_SCOPES,
} from '@/features/selection/toolbar-actions'
import Button from '@/ui/Button'
import IconButton from '@/ui/IconButton'
import Tabs from '@/ui/Tabs'
import { t } from '@/utils/i18n'
import type { SelectionActionScope, SelectionCustomAction } from '@/utils/settings'

import { INPUT_CLASS } from './layout'

export const ACTION_NAME_MAX = 12
const PROMPT_MAX = 2000

export type ActionDraft = Omit<SelectionCustomAction, 'id'>

/** 新增 / 编辑划词自定义动作 */
export default function SelectionActionDialog({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string
  initial: ActionDraft
  onSave: (draft: ActionDraft) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState('')
  const update = (patch: Partial<ActionDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setError('')
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const save = () => {
    const name = draft.name.trim()
    const prompt = draft.prompt.trim()
    if (!name) return setError(t('options.selection.dialog.nameRequired'))
    if (!prompt) return setError(t('options.selection.dialog.promptRequired'))
    onSave({ ...draft, name, prompt })
  }

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-[var(--ui-scrim)] p-4 backdrop-blur-sm'
      onClick={onClose}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-label={title}
        className='flex w-full max-w-[520px] flex-col gap-4 rounded-2xl border border-black/10 bg-white p-5 shadow-[var(--ui-shadow-popover)]'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='flex items-center justify-between gap-3'>
          <h3 className='text-[15px] font-semibold text-neutral-900'>{title}</h3>
          <IconButton label={t('options.selection.dialog.close')} onClick={onClose}>
            <X />
          </IconButton>
        </div>

        <label className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium text-neutral-600'>
            {t('options.selection.dialog.name')}
          </span>
          <input
            autoFocus
            value={draft.name}
            maxLength={ACTION_NAME_MAX}
            placeholder={t('options.selection.dialog.namePlaceholder')}
            onChange={(event) => update({ name: event.target.value })}
            className={INPUT_CLASS}
          />
        </label>

        <div className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium text-neutral-600'>
            {t('options.selection.dialog.icon')}
          </span>
          <div className='flex flex-wrap gap-1.5'>
            {Object.entries(ACTION_ICONS).map(([key, { icon: Icon, labelKey }]) => {
              const active = draft.icon === key
              const label = t(labelKey)
              return (
                <button
                  key={key}
                  type='button'
                  title={label}
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => update({ icon: key })}
                  className={`flex size-9 items-center justify-center rounded-lg border transition-colors ${
                    active
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900'
                  }`}
                >
                  <Icon className='size-4' strokeWidth={1.8} aria-hidden />
                </button>
              )
            })}
          </div>
        </div>

        <div className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium text-neutral-600'>
            {t('options.selection.dialog.scope')}
          </span>
          <div>
            <Tabs
              value={draft.scope}
              tabs={SELECTION_ACTION_SCOPES.map((scope) => ({
                value: scope,
                label: scopeLabel(scope),
              }))}
              onChange={(value) => update({ scope: value as SelectionActionScope })}
            />
          </div>
          <span className='text-xs leading-relaxed text-neutral-500'>
            {t('options.selection.dialog.scopeHint')}
          </span>
        </div>

        <label className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium text-neutral-600'>
            {t('options.selection.dialog.prompt')}
          </span>
          <textarea
            value={draft.prompt}
            rows={5}
            maxLength={PROMPT_MAX}
            placeholder={t('options.selection.dialog.promptPlaceholder')}
            onChange={(event) => update({ prompt: event.target.value })}
            className={`${INPUT_CLASS} resize-y leading-relaxed`}
          />
          <span className='text-xs leading-relaxed text-neutral-500'>
            {t('options.selection.dialog.promptHint')}
          </span>
        </label>

        <div className='flex items-center justify-end gap-2'>
          {error && <span className='mr-auto text-xs text-rose-500'>{error}</span>}
          <Button onClick={onClose}>{t('options.selection.dialog.cancel')}</Button>
          <Button variant='primary' onClick={save}>
            {t('options.selection.dialog.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
