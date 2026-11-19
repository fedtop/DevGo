import { useEffect, useRef, useState } from 'react'
import { Download, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'

import { exportSiteTool, parseImport } from '@/features/site-tools/import'
import {
  normalizeSiteTools,
  parseSiteToolDraft,
  SITE_TOOL_TEMPLATE,
  toDraft,
  type SiteTool,
  type SiteToolDraft,
} from '@/features/site-tools/types'
import Button from '@/ui/Button'
import ConfirmDialog from '@/ui/ConfirmDialog'
import IconButton from '@/ui/IconButton'
import Switch from '@/ui/Switch'
import { t } from '@/utils/i18n'
import { siteRecorderCapturePasswords, siteTools } from '@/utils/settings'
import { useStorageItem } from '@/utils/useStorageItem'

import { Card, INPUT_CLASS, Row } from './layout'

/** 设置页「站点工具」：列出、启停、按 JSON 编辑或删除站点工具 */
export default function SiteToolsCard() {
  const [stored, setStored] = useStorageItem(siteTools)
  const tools = normalizeSiteTools(stored)
  const [editing, setEditing] = useState<{ id?: string; draft: SiteToolDraft } | null>(null)
  const [deleting, setDeleting] = useState<SiteTool | null>(null)

  const save = (draft: SiteToolDraft) => {
    const now = Date.now()
    setStored(
      editing?.id
        ? tools.map((item) =>
            item.id === editing.id ? { ...item, ...draft, updatedAt: now } : item,
          )
        : [...tools, { ...draft, id: crypto.randomUUID(), enabled: true, updatedAt: now }],
    )
    setEditing(null)
  }

  const toggle = (id: string, enabled: boolean) =>
    setStored(tools.map((item) => (item.id === id ? { ...item, enabled } : item)))

  const [capturePasswords, setCapturePasswords] = useStorageItem(siteRecorderCapturePasswords)
  const fileRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)

  /** 导入：同名工具覆盖，其余追加 */
  const importFile = async (file: File) => {
    const result = parseImport(await file.text())
    if (!result.ok) {
      setNotice({
        text: t('options.assistant.siteTools.importFailed', { error: result.error }),
        error: true,
      })
      return
    }
    const now = Date.now()
    let next = [...tools]
    for (const draft of result.drafts) {
      const existing = next.find((item) => item.name === draft.name)
      next = existing
        ? next.map((item) =>
            item.id === existing.id ? { ...item, ...draft, updatedAt: now } : item,
          )
        : [...next, { ...draft, id: crypto.randomUUID(), enabled: true, updatedAt: now }]
    }
    setStored(next)
    setNotice({ text: t('options.assistant.siteTools.imported', { count: result.drafts.length }) })
  }

  const exportTool = (tool: SiteTool) => {
    const url = URL.createObjectURL(
      new Blob([exportSiteTool(toDraft(tool))], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `devgo-tool-${tool.name}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <Card
      title={t('options.assistant.siteTools.title')}
      desc={t('options.assistant.siteTools.desc')}
      extra={
        <div className='flex items-center gap-1.5'>
          <Button onClick={() => fileRef.current?.click()} className='!px-2.5 !py-1 text-xs'>
            <Upload className='size-3.5' aria-hidden />
            {t('options.assistant.siteTools.import')}
          </Button>
          <Button
            onClick={() => setEditing({ draft: SITE_TOOL_TEMPLATE })}
            className='!px-2.5 !py-1 text-xs'
          >
            <Plus className='size-3.5' aria-hidden />
            {t('options.assistant.siteTools.add')}
          </Button>
          <input
            ref={fileRef}
            type='file'
            accept='.json,application/json'
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void importFile(file)
            }}
          />
        </div>
      }
    >
      <p className='text-xs leading-relaxed text-neutral-500'>
        {t('options.assistant.siteTools.importHint')}
      </p>
      {notice && (
        <p className={`text-xs ${notice.error ? 'text-rose-600' : 'text-emerald-700'}`}>
          {notice.text}
        </p>
      )}
      {tools.length > 0 ? (
        <ul className='flex flex-col divide-y divide-neutral-100'>
          {tools.map((tool) => (
            <li key={tool.id} className='flex items-center gap-3 py-2'>
              <div className='flex min-w-0 flex-1 flex-col'>
                <span className='flex items-center gap-2'>
                  <span className='truncate font-mono text-sm text-neutral-900'>{tool.name}</span>
                  <span className='shrink-0 rounded-full bg-black/5 px-1.5 text-[10px] leading-4 text-neutral-600'>
                    {tool.readOnly
                      ? t('options.assistant.siteTools.readOnly')
                      : t('options.assistant.siteTools.mayModify')}
                  </span>
                </span>
                <span className='truncate text-xs text-neutral-500' title={tool.description}>
                  {tool.matches.join('、')} ·{' '}
                  {t('options.assistant.siteTools.stepCount', { count: tool.steps.length })} ·{' '}
                  {tool.description}
                </span>
              </div>
              <div className='flex shrink-0 items-center gap-1'>
                <Switch checked={tool.enabled} onChange={(enabled) => toggle(tool.id, enabled)} />
                <IconButton
                  label={t('options.assistant.siteTools.edit')}
                  onClick={() => setEditing({ id: tool.id, draft: toDraft(tool) })}
                  className='!size-7 [&_svg]:!size-4'
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  label={t('options.assistant.siteTools.export')}
                  onClick={() => exportTool(tool)}
                  className='!size-7 [&_svg]:!size-4'
                >
                  <Download />
                </IconButton>
                <IconButton
                  label={t('options.assistant.siteTools.delete')}
                  onClick={() => setDeleting(tool)}
                  className='!size-7 hover:!text-rose-600 [&_svg]:!size-4'
                >
                  <Trash2 />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-xs leading-relaxed text-neutral-500'>
          {t('options.assistant.siteTools.empty')}
        </p>
      )}

      <div className='border-t border-neutral-100 pt-3'>
        <Row
          label={t('options.assistant.siteTools.capturePasswords')}
          hint={t('options.assistant.siteTools.capturePasswordsHint')}
        >
          <Switch checked={capturePasswords} onChange={setCapturePasswords} />
        </Row>
      </div>

      {editing && (
        <SiteToolDialog
          title={
            editing.id
              ? t('options.assistant.siteTools.editTitle')
              : t('options.assistant.siteTools.addTitle')
          }
          initial={editing.draft}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('options.assistant.siteTools.deleteTitle', { name: deleting.name })}
          confirmLabel={t('options.assistant.siteTools.delete')}
          onConfirm={() => {
            setStored(tools.filter((item) => item.id !== deleting.id))
            setDeleting(null)
          }}
          onClose={() => setDeleting(null)}
        >
          <p>{t('options.assistant.siteTools.deleteDesc')}</p>
        </ConfirmDialog>
      )}
    </Card>
  )
}

/** 以 JSON 编辑站点工具定义（适合会写选择器的用户；一般让 AI 生成即可） */
function SiteToolDialog({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string
  initial: SiteToolDraft
  onSave: (draft: SiteToolDraft) => void
  onClose: () => void
}) {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2))
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const save = () => {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      setError(t('options.assistant.siteTools.invalidJson'))
      return
    }
    const parsed = parseSiteToolDraft(value)
    if (!parsed.ok) setError(parsed.error)
    else onSave(parsed.draft)
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
        className='flex max-h-full w-full max-w-[640px] flex-col gap-4 rounded-2xl border border-black/10 bg-white p-5 shadow-[var(--ui-shadow-popover)]'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='flex items-center justify-between gap-3'>
          <h3 className='text-[15px] font-semibold text-neutral-900'>{title}</h3>
          <IconButton label={t('options.assistant.siteTools.cancel')} onClick={onClose}>
            <X />
          </IconButton>
        </div>

        <label className='flex min-h-0 flex-col gap-1.5'>
          <span className='text-xs font-medium text-neutral-600'>
            {t('options.assistant.siteTools.json')}
          </span>
          <textarea
            autoFocus
            value={text}
            rows={20}
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value)
              setError('')
            }}
            className={`${INPUT_CLASS} min-h-0 resize-y font-mono text-xs leading-relaxed`}
          />
          <span className='text-xs leading-relaxed text-neutral-500'>
            {t('options.assistant.siteTools.jsonHint')}
          </span>
        </label>

        <div className='flex items-center justify-end gap-2'>
          {error && <span className='mr-auto text-xs text-rose-500'>{error}</span>}
          <Button onClick={onClose}>{t('options.assistant.siteTools.cancel')}</Button>
          <Button variant='primary' onClick={save}>
            {t('options.assistant.siteTools.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
