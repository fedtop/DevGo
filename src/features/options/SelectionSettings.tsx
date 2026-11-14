import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react'

import {
  actionIcon,
  DEFAULT_ACTION_ICON,
  getBuiltinActions,
  getSelectionActionTemplates,
  MAX_TOOLBAR_ACTIONS,
  normalizeCustomActions,
  scopeLabel,
} from '@/features/selection/toolbar-actions'
import Button from '@/ui/Button'
import ConfirmDialog from '@/ui/ConfirmDialog'
import IconButton from '@/ui/IconButton'
import Switch from '@/ui/Switch'
import { t } from '@/utils/i18n'
import {
  enableSelectionTranslate,
  selectionAiEnabled,
  selectionCustomActions,
  selectionDisabledHosts,
  selectionHiddenBuiltinActions,
  type SelectionCustomAction,
} from '@/utils/settings'
import { useStorageItem } from '@/utils/useStorageItem'

import { Card, Row, SectionHeader } from './layout'
import SelectionActionDialog, { type ActionDraft } from './SelectionActionDialog'

const EMPTY_DRAFT: ActionDraft = { name: '', prompt: '', icon: DEFAULT_ACTION_ICON, scope: 'page' }

function ScopeTag({ children }: { children: string }) {
  return (
    <span className='shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500'>
      {children}
    </span>
  )
}

/** 工具条动作：内置动作的显示开关 + 自定义动作的增删改排序 */
function ActionsCard({ aiEnabled }: { aiEnabled: boolean }) {
  const [hidden, setHidden] = useStorageItem(selectionHiddenBuiltinActions)
  const [stored, setStored] = useStorageItem(selectionCustomActions)
  const custom = normalizeCustomActions(stored)
  const [editing, setEditing] = useState<{ id?: string; draft: ActionDraft } | null>(null)
  const [deleting, setDeleting] = useState<SelectionCustomAction | null>(null)

  const toggleBuiltin = (id: string, shown: boolean) =>
    setHidden(shown ? hidden.filter((item) => item !== id) : [...hidden, id])

  const save = (draft: ActionDraft) => {
    if (editing?.id) {
      setStored(custom.map((item) => (item.id === editing.id ? { ...item, ...draft } : item)))
    } else {
      setStored([...custom, { id: crypto.randomUUID(), ...draft }])
    }
    setEditing(null)
  }

  const move = (index: number, offset: -1 | 1) => {
    const next = [...custom]
    const [item] = next.splice(index, 1)
    next.splice(index + offset, 0, item)
    setStored(next)
  }

  return (
    <Card
      title={t('options.selection.actions.title')}
      desc={t('options.selection.actions.desc', { count: MAX_TOOLBAR_ACTIONS })}
      extra={
        <Button
          onClick={() => setEditing({ draft: EMPTY_DRAFT })}
          className='!px-2.5 !py-1 text-xs'
        >
          <Plus className='size-3.5' aria-hidden />
          {t('options.selection.actions.add')}
        </Button>
      }
    >
      {!aiEnabled && (
        <p className='rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700'>
          {t('options.selection.actions.aiUnavailable')}
        </p>
      )}

      <div className='flex flex-col gap-2'>
        <h3 className='text-xs font-medium text-neutral-500'>
          {t('options.selection.actions.builtin')}
        </h3>
        <ul className='flex flex-col divide-y divide-neutral-100'>
          {getBuiltinActions().map(({ id, label, title, icon: Icon, scope }) => (
            <li key={id} className='flex items-center gap-3 py-2'>
              <Icon className='size-4 shrink-0 text-neutral-500' strokeWidth={1.8} aria-hidden />
              <span className='text-sm text-neutral-900'>{label}</span>
              <ScopeTag>{scopeLabel(scope)}</ScopeTag>
              <span className='min-w-0 flex-1 truncate text-xs text-neutral-500'>{title}</span>
              <Switch
                checked={!hidden.includes(id)}
                onChange={(shown) => toggleBuiltin(id, shown)}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className='flex flex-col gap-2 border-t border-neutral-100 pt-3'>
        <h3 className='text-xs font-medium text-neutral-500'>
          {t('options.selection.actions.custom')}
        </h3>
        {custom.length > 0 ? (
          <ul className='flex flex-col divide-y divide-neutral-100'>
            {custom.map((action, index) => {
              const Icon = actionIcon(action.icon)
              return (
                <li key={action.id} className='flex items-center gap-3 py-2'>
                  <Icon
                    className='size-4 shrink-0 text-neutral-500'
                    strokeWidth={1.8}
                    aria-hidden
                  />
                  <span className='shrink-0 text-sm text-neutral-900'>{action.name}</span>
                  <ScopeTag>{scopeLabel(action.scope)}</ScopeTag>
                  <span
                    className='min-w-0 flex-1 truncate text-xs text-neutral-500'
                    title={action.prompt}
                  >
                    {action.prompt}
                  </span>
                  <div className='flex shrink-0 items-center'>
                    <IconButton
                      label={t('options.selection.actions.moveUp')}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className='!size-7 [&_svg]:!size-4'
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      label={t('options.selection.actions.moveDown')}
                      disabled={index === custom.length - 1}
                      onClick={() => move(index, 1)}
                      className='!size-7 [&_svg]:!size-4'
                    >
                      <ArrowDown />
                    </IconButton>
                    <IconButton
                      label={t('options.selection.actions.edit')}
                      onClick={() => setEditing({ id: action.id, draft: action })}
                      className='!size-7 [&_svg]:!size-4'
                    >
                      <Pencil />
                    </IconButton>
                    <IconButton
                      label={t('options.selection.actions.delete')}
                      onClick={() => setDeleting(action)}
                      className='!size-7 hover:!text-rose-600 [&_svg]:!size-4'
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className='text-xs text-neutral-500'>{t('options.selection.actions.empty')}</p>
        )}

        <div className='flex flex-wrap items-center gap-2 pt-1'>
          <span className='text-xs text-neutral-500'>
            {t('options.selection.actions.fromTemplates')}
          </span>
          {getSelectionActionTemplates().map((template) => {
            const Icon = actionIcon(template.icon)
            const added = custom.some((item) => item.name === template.name)
            return (
              <button
                key={template.name}
                type='button'
                disabled={added}
                title={added ? t('options.selection.actions.templateAdded') : template.prompt}
                onClick={() => setStored([...custom, { id: crypto.randomUUID(), ...template }])}
                className='flex items-center gap-1 rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-700 transition-colors hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50'
              >
                <Icon className='size-3.5' strokeWidth={1.8} aria-hidden />
                {template.name}
                {added ? (
                  <Check className='size-3' aria-hidden />
                ) : (
                  <Plus className='size-3' aria-hidden />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {editing && (
        <SelectionActionDialog
          title={
            editing.id
              ? t('options.selection.actions.editTitle')
              : t('options.selection.actions.add')
          }
          initial={editing.draft}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('options.selection.actions.deleteTitle', { name: deleting.name })}
          confirmLabel={t('options.selection.actions.delete')}
          onConfirm={() => {
            setStored(custom.filter((item) => item.id !== deleting.id))
            setDeleting(null)
          }}
          onClose={() => setDeleting(null)}
        >
          <p>{t('options.selection.actions.deleteDesc')}</p>
        </ConfirmDialog>
      )}
    </Card>
  )
}

/** 设置页：划词 */
export default function SelectionSettings() {
  const [enabled, setEnabled] = useStorageItem(enableSelectionTranslate)
  const [aiEnabled, setAiEnabled] = useStorageItem(selectionAiEnabled)
  const [disabledHosts, setDisabledHosts] = useStorageItem(selectionDisabledHosts)

  return (
    <div className='flex flex-col gap-5'>
      <SectionHeader title={t('options.selection.title')} desc={t('options.selection.desc')} />

      <Card title={t('options.selection.toolbar.title')}>
        <Row
          label={t('options.selection.toolbar.enable')}
          hint={t('options.selection.toolbar.enableHint')}
        >
          <Switch checked={enabled} onChange={setEnabled} />
        </Row>
        <Row label={t('options.selection.toolbar.ai')} hint={t('options.selection.toolbar.aiHint')}>
          <Switch checked={aiEnabled} onChange={setAiEnabled} disabled={!enabled} />
        </Row>
      </Card>

      <Card
        title={t('options.selection.disabledHosts.title')}
        desc={t('options.selection.disabledHosts.desc')}
      >
        {disabledHosts.length > 0 ? (
          <ul className='flex flex-wrap gap-2'>
            {disabledHosts.map((host) => (
              <li
                key={host}
                className='flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 py-1 pr-1.5 pl-3 text-xs text-neutral-600'
              >
                {host}
                <button
                  type='button'
                  aria-label={t('options.selection.disabledHosts.remove', { host })}
                  onClick={() => setDisabledHosts(disabledHosts.filter((item) => item !== host))}
                  className='flex h-4 w-4 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-600'
                >
                  <X className='size-3' aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-xs text-neutral-500'>{t('options.selection.disabledHosts.empty')}</p>
        )}
      </Card>

      <ActionsCard aiEnabled={enabled && aiEnabled} />
    </div>
  )
}
