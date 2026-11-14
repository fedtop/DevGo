import { useRef, useState } from 'react'

import { getPopupPages } from '@/features/popup/pages'
import Button from '@/ui/Button'
import Tabs from '@/ui/Tabs'
import Select from '@/ui/Select'
import { buildBackup, restoreBackup } from '@/utils/backup'
import { getLocale, t, uiLanguage, type MessageKey, type UiLanguage } from '@/utils/i18n'
import { sendRuntimeMessage } from '@/utils/messaging'
import { defaultPopupTab, syncStatus, themeMode, type ThemeMode } from '@/utils/settings'
import { formatShortcut, openShortcutSettings } from '@/utils/shortcut'
import { useCommandShortcuts } from '@/utils/useCommandShortcuts'
import { normalizeThemeMode } from '@/utils/theme'
import { useStorageItem } from '@/utils/useStorageItem'

import { Card, Row, SectionHeader } from './layout'
import { ArrowUpRight } from 'lucide-react'

/** 命令 name -> 展示名 key（按声明顺序展示） */
const COMMAND_LABELS: Record<string, MessageKey> = {
  'open-default': 'options.general.shortcuts.openDefault',
  'open-assistant': 'options.general.shortcuts.openAssistant',
  'open-network': 'options.general.shortcuts.openNetwork',
  'open-tools': 'options.general.shortcuts.openTools',
  'inline-translate': 'options.general.shortcuts.inlineTranslate',
}

/** chrome.storage.sync 总配额 */
const SYNC_QUOTA_BYTES = 102_400

function formatSyncTime(timestamp: number): string {
  const date = new Date(timestamp)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(getLocale(), {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

/** 外观：主题与新标签页共用同一个设置；界面语言对所有页面和划词工具条生效 */
function AppearanceCard() {
  const [mode, setMode] = useStorageItem(themeMode)
  const [language, setLanguage] = useStorageItem(uiLanguage)

  const themeOptions: Array<{ value: ThemeMode; label: string }> = [
    { value: 'auto', label: t('options.general.appearance.themeAuto') },
    { value: 'light', label: t('options.general.appearance.themeLight') },
    { value: 'dark', label: t('options.general.appearance.themeDark') },
  ]
  // 语言名称用各自的语言写，方便看不懂当前界面语言的人也能找到
  const languageOptions: Array<{ value: UiLanguage; label: string }> = [
    { value: 'auto', label: t('common.language.auto') },
    { value: 'zh-CN', label: '中文' },
    { value: 'en', label: 'English' },
  ]

  return (
    <Card title={t('options.general.appearance.title')}>
      <Row
        label={t('options.general.appearance.theme')}
        hint={t('options.general.appearance.themeHint')}
      >
        <Tabs
          value={normalizeThemeMode(mode)}
          tabs={themeOptions}
          onChange={(value) => setMode(value as ThemeMode)}
        />
      </Row>
      <Row
        label={t('options.general.appearance.language')}
        hint={t('options.general.appearance.languageHint')}
      >
        <Tabs
          value={language}
          tabs={languageOptions}
          onChange={(value) => setLanguage(value as UiLanguage)}
        />
      </Row>
    </Card>
  )
}

function ShortcutsCard() {
  const bound = useCommandShortcuts()
  // 只列出当前浏览器实际注册的命令（如 Firefox 没有侧边栏命令）
  const shortcuts = Object.keys(COMMAND_LABELS)
    .filter((name) => name in bound)
    .map((name) => ({ name, shortcut: bound[name] }))

  return (
    <Card
      title={t('options.general.shortcuts.title')}
      desc={
        import.meta.env.FIREFOX
          ? t('options.general.shortcuts.descFirefox')
          : t('options.general.shortcuts.desc')
      }
      extra={
        // Chrome 命令快捷键只能在系统设置页修改；Firefox 的 about:addons 扩展无权打开
        !import.meta.env.FIREFOX && (
          <Button onClick={() => void openShortcutSettings()} className='!px-2.5 !py-1 text-xs'>
            {t('options.general.shortcuts.customize')}
            <ArrowUpRight className='size-3' aria-hidden />
          </Button>
        )
      }
    >
      <div className='flex flex-col gap-2'>
        {shortcuts.map((item) => (
          <div key={item.name} className='flex items-center justify-between text-sm'>
            <span className='text-neutral-600'>{t(COMMAND_LABELS[item.name])}</span>
            {item.shortcut ? (
              <kbd className='rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600'>
                {formatShortcut(item.shortcut)}
              </kbd>
            ) : (
              <span className='text-xs text-neutral-500'>{t('common.notSet')}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

/** 跨设备同步：同步范围说明 + 状态 + 手动同步 */
function SyncCard() {
  const [status] = useStorageItem(syncStatus)
  const [running, setRunning] = useState(false)

  const syncing = running || status.state === 'syncing'
  const usage =
    status.bytesInUse !== undefined
      ? t('options.general.sync.usage', {
          used: (status.bytesInUse / 1024).toFixed(1),
          total: SYNC_QUOTA_BYTES / 1024,
        })
      : ''

  let summary = t('options.general.sync.never')
  if (syncing) summary = t('options.general.sync.syncing')
  else if (status.state === 'error') summary = status.message || t('options.general.sync.failed')
  else if (status.lastSyncedAt) {
    summary = t('options.general.sync.lastSynced', { time: formatSyncTime(status.lastSyncedAt) })
  }

  const syncNow = async () => {
    setRunning(true)
    try {
      await sendRuntimeMessage({ type: 'sync-now' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card
      title={t('options.general.sync.title')}
      desc={t('options.general.sync.desc')}
      extra={
        <Button onClick={() => void syncNow()} disabled={syncing} className='!px-2.5 !py-1 text-xs'>
          {t('options.general.sync.syncNow')}
        </Button>
      }
    >
      <div className='flex items-center justify-between gap-2 text-sm'>
        <span
          className={`truncate ${
            status.state === 'error' && !syncing ? 'text-rose-500' : 'text-neutral-600'
          }`}
        >
          {summary}
        </span>
        {usage && <span className='shrink-0 text-xs text-neutral-500'>{usage}</span>}
      </div>
    </Card>
  )
}

function BackupCard() {
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 导出全部配置（含快捷导航、网络配置等）为 JSON 文件
  const exportBackup = async () => {
    try {
      const backup = await buildBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `devgo-backup-${backup.exportedAt.slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(t('options.general.backup.exported'))
    } catch {
      setMessage(t('options.general.backup.exportFailed'))
    }
  }

  const importBackup = async (file: File) => {
    try {
      const { imported, skipped } = await restoreBackup(await file.text())
      setMessage(
        skipped.length > 0
          ? t('options.general.backup.importedWithSkipped', { imported, skipped: skipped.length })
          : t('options.general.backup.imported', { imported }),
      )
    } catch (error) {
      setMessage(
        t('options.general.backup.importFailed', {
          reason: error instanceof Error ? error.message : t('common.unknownError'),
        }),
      )
    }
  }

  return (
    <Card title={t('options.general.backup.title')} desc={t('options.general.backup.desc')}>
      <div className='flex items-center gap-2'>
        <Button onClick={() => void exportBackup()}>{t('options.general.backup.export')}</Button>
        <Button onClick={() => fileInputRef.current?.click()}>
          {t('options.general.backup.import')}
        </Button>
        {message && <span className='ml-2 text-xs text-neutral-500'>{message}</span>}
      </div>
      <input
        ref={fileInputRef}
        type='file'
        accept='.json,application/json'
        className='hidden'
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importBackup(file)
          // 清空选择，同一文件可重复导入
          event.target.value = ''
        }}
      />
    </Card>
  )
}

/** 设置页：通用 */
export default function GeneralSettings() {
  const [defaultTab, setDefaultTab] = useStorageItem(defaultPopupTab)

  return (
    <div className='flex flex-col gap-5'>
      <SectionHeader title={t('options.general.title')} desc={t('options.general.desc')} />

      <AppearanceCard />

      <Card title={t('options.general.popup.title')}>
        <Row
          label={t('options.general.popup.defaultTab')}
          hint={t('options.general.popup.defaultTabHint')}
        >
          <Select
            value={defaultTab}
            options={getPopupPages()}
            onChange={setDefaultTab}
            className='w-32'
          />
        </Row>
      </Card>

      <ShortcutsCard />
      <SyncCard />
      <BackupCard />
    </div>
  )
}
