import { useEffect, useState, type ReactNode } from 'react'

import { useActiveTabId, useWebmcpTools } from '@/features/assistant/webmcp-client'
import Button from '@/ui/Button'
import Switch from '@/ui/Switch'
import { t } from '@/utils/i18n'
import {
  dockDisabledHosts,
  dockEnabled,
  enableSelectionTranslate,
  selectionDisabledHosts,
  sidepanelView,
  unlockHosts,
  type SidepanelView,
} from '@/utils/settings'
import { sendRuntimeMessage, type CaptureFormat } from '@/utils/messaging'
import { formatShortcut } from '@/utils/shortcut'
import { useCommandShortcuts } from '@/utils/useCommandShortcuts'
import { getActiveHostname } from '@/utils/tabs'
import { useStorageItem } from '@/utils/useStorageItem'
import { ArrowUpRight, FileText, ImageDown, SquareDashedMousePointer } from 'lucide-react'

function Row({ title, desc, children }: { title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2.5'>
      <div className='flex min-w-0 flex-col'>
        <span className='text-sm font-medium text-neutral-800'>{title}</span>
        <span className='truncate text-xs text-neutral-500'>{desc}</span>
      </div>
      <div className='shrink-0'>{children}</div>
    </div>
  )
}

/**
 * 打开侧边栏的按钮（仅 Chrome 支持侧边栏）。
 * sidePanel.open 必须在点击的同步调用栈里执行，所以提前取好 windowId
 */
function OpenSidePanelButton({
  view,
  label,
  disabled = false,
}: {
  view: SidepanelView
  label?: string
  disabled?: boolean
}) {
  const [windowId, setWindowId] = useState<number | null>(null)

  useEffect(() => {
    if (!chrome.sidePanel) return
    void browser.windows.getCurrent().then((win) => setWindowId(win.id ?? null))
  }, [])

  const open = () => {
    if (windowId == null) return
    // 先写入要显示的页面，侧边栏打开后（或已开着时）读取并切换
    void sidepanelView.setValue(view)
    void chrome.sidePanel.open({ windowId }).then(() => window.close())
  }

  return (
    <Button
      variant='primary'
      onClick={open}
      disabled={windowId == null || disabled}
      className='!px-3 !py-1 text-xs'
    >
      {label ?? t('popup.function.open')}
    </Button>
  )
}

function AssistantRow() {
  const shortcut = useCommandShortcuts()['open-assistant'] ?? ''

  return (
    <Row
      title={t('popup.function.assistantTitle')}
      desc={
        shortcut
          ? t('popup.function.assistantDescShortcut', { shortcut: formatShortcut(shortcut) })
          : t('popup.function.assistantDesc')
      }
    >
      <OpenSidePanelButton view='chat' />
    </Row>
  )
}

/** 当前网页的 WebMCP 工具：有工具时打开侧边栏的「网页工具」页查看、手动执行 */
function WebmcpRow() {
  const tabId = useActiveTabId()
  const { tools, status } = useWebmcpTools(tabId)

  const desc =
    status === 'loading'
      ? t('popup.function.webmcpLoading')
      : status === 'unsupported'
        ? t('popup.function.webmcpUnsupported')
        : status === 'unavailable'
          ? t('popup.common.pageUnsupported')
          : tools.length
            ? t('popup.function.webmcpTools', { count: tools.length })
            : t('popup.function.webmcpNoTools')

  return (
    <Row title={t('popup.function.webmcpTitle')} desc={desc}>
      <OpenSidePanelButton
        view='tools'
        label={t('popup.function.viewTools')}
        disabled={status !== 'ready' || tools.length === 0}
      />
    </Row>
  )
}

type BooleanItem = typeof enableSelectionTranslate
type HostListItem = typeof selectionDisabledHosts

/**
 * 「全局开关 + 按网站停用」类功能的当前网站开关（划词工具条、悬浮快捷栏）。
 * 开关作用于当前网站；全局关闭时开关显示为关，打开即恢复全局开启。
 */
function SiteSwitchRow({
  title,
  enabledItem,
  hostsItem,
  feature,
}: {
  title: string
  enabledItem: BooleanItem
  hostsItem: HostListItem
  /** 开启时的说明，如「选中文字后显示翻译与 AI 工具条」 */
  feature: string
}) {
  const [enabled, setEnabled] = useStorageItem(enabledItem)
  const [disabledHosts, setDisabledHosts] = useStorageItem(hostsItem)
  const [hostname, setHostname] = useState('')

  useEffect(() => {
    void getActiveHostname().then(setHostname)
  }, [])

  const siteDisabled = Boolean(hostname) && disabledHosts.includes(hostname)
  const checked = enabled && !siteDisabled
  const toggle = (next: boolean) => {
    if (!enabled) {
      if (next) {
        setEnabled(true)
        if (siteDisabled) setDisabledHosts(disabledHosts.filter((h) => h !== hostname))
      }
      return
    }
    if (!hostname) return
    setDisabledHosts(
      next
        ? disabledHosts.filter((h) => h !== hostname)
        : [...new Set([...disabledHosts, hostname])],
    )
  }

  const desc = !enabled
    ? t('popup.function.siteSwitch.globallyOff')
    : !hostname
      ? t('popup.common.pageUnsupported')
      : siteDisabled
        ? t('popup.function.siteSwitch.siteDisabled', { host: hostname })
        : disabledHosts.length
          ? t('popup.function.siteSwitch.siteOnWithDisabled', {
              host: hostname,
              feature,
              count: disabledHosts.length,
            })
          : t('popup.function.siteSwitch.siteOn', { host: hostname, feature })

  return (
    <Row title={title} desc={desc}>
      <Switch checked={checked} onChange={toggle} disabled={enabled && !hostname} />
    </Row>
  )
}

/** 导出网页：整页 PDF / 长图，或在网页里框选区域导出 */
function CaptureRow() {
  const tabId = useActiveTabId()
  const [hostname, setHostname] = useState('')
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getActiveHostname().then(setHostname)
  }, [])

  const fail = (error: unknown) =>
    setStatus({ text: error instanceof Error ? error.message : String(error), error: true })

  const exportPage = (format: CaptureFormat) => {
    setBusy(true)
    setStatus({ text: t('capture.popup.exporting') })
    void sendRuntimeMessage({ type: 'capture-page', format, tabId: tabId ?? undefined })
      .then((result) =>
        setStatus(
          result.ok
            ? { text: t('capture.popup.done', { name: result.fileName ?? '' }) }
            : { text: result.error ?? '', error: true },
        ),
      )
      .catch(fail)
      .finally(() => setBusy(false))
  }

  const pick = () => {
    void sendRuntimeMessage({ type: 'capture-pick', tabId: tabId ?? undefined })
      .then((result) => {
        if (result.ok) window.close()
        else setStatus({ text: result.error ?? '', error: true })
      })
      .catch(fail)
  }

  const disabled = busy || !hostname || tabId == null

  return (
    <div className='flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5'>
      <div className='flex min-w-0 flex-col'>
        <span className='text-sm font-medium text-neutral-800'>{t('capture.popup.title')}</span>
        <span
          className={`text-xs ${status?.error ? 'text-amber-600' : 'text-neutral-500'} ${status ? 'break-all' : 'truncate'}`}
        >
          {status?.text ?? (hostname ? t('capture.popup.desc') : t('popup.common.pageUnsupported'))}
        </span>
      </div>
      <div className='grid grid-cols-3 gap-1.5'>
        {(
          [
            [FileText, t('capture.popup.pagePdf'), () => exportPage('pdf')],
            [ImageDown, t('capture.popup.pagePng'), () => exportPage('png')],
            [SquareDashedMousePointer, t('capture.popup.pick'), pick],
          ] as const
        ).map(([Icon, label, onClick]) => (
          <button
            key={label}
            type='button'
            onClick={onClick}
            disabled={disabled}
            className='flex flex-col items-center gap-1 rounded-md border border-neutral-200 py-2 text-xs text-neutral-700 transition-colors enabled:hover:border-accent-300 enabled:hover:bg-accent-50/60 enabled:hover:text-accent-600 disabled:cursor-not-allowed disabled:opacity-50'
          >
            <Icon className='size-4' strokeWidth={1.75} aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 解除复制限制：只对当前站点开关（全局阻断 copy 等事件会让在线编辑器失灵） */
function UnlockSiteRow() {
  const [hosts, setHosts] = useStorageItem(unlockHosts)
  const [hostname, setHostname] = useState('')

  useEffect(() => {
    void getActiveHostname().then(setHostname)
  }, [])

  const enabled = Boolean(hostname) && hosts.includes(hostname)
  const toggle = (checked: boolean) => {
    if (!hostname) return
    setHosts(checked ? [...new Set([...hosts, hostname])] : hosts.filter((h) => h !== hostname))
  }

  return (
    <Row
      title={t('popup.function.unlockTitle')}
      desc={
        !hostname
          ? t('popup.common.pageUnsupported')
          : hosts.length > 1
            ? t('popup.function.unlockDescWithCount', { host: hostname, count: hosts.length })
            : t('popup.function.unlockDesc', { host: hostname })
      }
    >
      <Switch checked={enabled} onChange={toggle} disabled={!hostname} />
    </Row>
  )
}

/** popup「功能」页：侧边栏入口与针对当前网站的开关，全局设置在设置页 */
export default function FunctionPage() {
  const openEnhanceSettings = () => {
    void browser.tabs
      .create({ url: browser.runtime.getURL('/options.html#enhance') })
      .finally(() => window.close())
  }

  return (
    <div className='flex flex-col gap-2.5'>
      {chrome.sidePanel && (
        <>
          <AssistantRow />
          <WebmcpRow />
        </>
      )}
      <SiteSwitchRow
        title={t('popup.function.dockTitle')}
        enabledItem={dockEnabled}
        hostsItem={dockDisabledHosts}
        feature={t('popup.function.dockFeature')}
      />
      <SiteSwitchRow
        title={t('popup.function.selectionTitle')}
        enabledItem={enableSelectionTranslate}
        hostsItem={selectionDisabledHosts}
        feature={t('popup.function.selectionFeature')}
      />
      <CaptureRow />
      <UnlockSiteRow />
      <button
        type='button'
        onClick={openEnhanceSettings}
        className='self-end text-xs text-neutral-500 transition-colors hover:text-accent-600'
      >
        {t('popup.function.manageAll')}
        <ArrowUpRight className='ml-0.5 inline size-3 -translate-y-px' aria-hidden />
      </button>
    </div>
  )
}
