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
import { formatShortcut } from '@/utils/shortcut'
import { useCommandShortcuts } from '@/utils/useCommandShortcuts'
import { getActiveHostname } from '@/utils/tabs'
import { useStorageItem } from '@/utils/useStorageItem'
import { ArrowUpRight } from 'lucide-react'

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
    ? t('popup.function.selectionGloballyOff')
    : !hostname
      ? t('popup.common.pageUnsupported')
      : siteDisabled
        ? `已在 ${hostname} 停用`
        : `${hostname}：${feature}${
            disabledHosts.length ? `（${disabledHosts.length} 个网站已停用）` : ''
          }`

  return (
    <Row title={title} desc={desc}>
      <Switch checked={checked} onChange={toggle} disabled={enabled && !hostname} />
    </Row>
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
        title='悬浮快捷栏'
        enabledItem={dockEnabled}
        hostsItem={dockDisabledHosts}
        feature='网页右侧的快捷按钮（翻译、AI 总结等）'
      />
      <SiteSwitchRow
        title='划词工具条'
        enabledItem={enableSelectionTranslate}
        hostsItem={selectionDisabledHosts}
        feature='选中文字后显示翻译与 AI 工具条'
      />
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
