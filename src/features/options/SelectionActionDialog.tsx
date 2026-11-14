import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

import { ACTION_ICONS, SCOPE_LABELS } from '@/features/selection/toolbar-actions'
import Button from '@/ui/Button'
import IconButton from '@/ui/IconButton'
import Tabs from '@/ui/Tabs'
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
    if (!name) return setError('请填写名称')
    if (!prompt) return setError('请填写提示词')
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
          <IconButton label='关闭' onClick={onClose}>
            <X />
          </IconButton>
        </div>

        <label className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium text-neutral-600'>名称</span>
          <input
            autoFocus
            value={draft.name}
            maxLength={ACTION_NAME_MAX}
            placeholder='显示在工具条上，如「译成英文」'
            onChange={(event) => update({ name: event.target.value })}
            className={INPUT_CLASS}
          />
        </label>

        <div className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium text-neutral-600'>图标</span>
          <div className='flex flex-wrap gap-1.5'>
            {Object.entries(ACTION_ICONS).map(([key, { icon: Icon, label }]) => {
              const active = draft.icon === key
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
          <span className='text-xs font-medium text-neutral-600'>适用范围</span>
          <div>
            <Tabs
              value={draft.scope}
              tabs={(Object.keys(SCOPE_LABELS) as SelectionActionScope[]).map((scope) => ({
                value: scope,
                label: SCOPE_LABELS[scope],
              }))}
              onChange={(value) => update({ scope: value as SelectionActionScope })}
            />
          </div>
          <span className='text-xs leading-relaxed text-neutral-500'>
            在输入框里选中文字时，结果可以一键「替换原文」，此时模型只输出处理后的文字。
          </span>
        </div>

        <label className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium text-neutral-600'>提示词</span>
          <textarea
            value={draft.prompt}
            rows={5}
            maxLength={PROMPT_MAX}
            placeholder='告诉 AI 怎么处理选中的内容，如：把选中的内容翻译成地道的英文，只输出译文。'
            onChange={(event) => update({ prompt: event.target.value })}
            className={`${INPUT_CLASS} resize-y leading-relaxed`}
          />
          <span className='text-xs leading-relaxed text-neutral-500'>
            和内置动作一样，会自动附带选中内容所在的段落和网页标题，不用在提示词里写。
          </span>
        </label>

        <div className='flex items-center justify-end gap-2'>
          {error && <span className='mr-auto text-xs text-rose-500'>{error}</span>}
          <Button onClick={onClose}>取消</Button>
          <Button variant='primary' onClick={save}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
