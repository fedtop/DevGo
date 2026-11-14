import { useEffect, useState } from 'react'

import Button from '@/ui/Button'
import Switch from '@/ui/Switch'
import { t } from '@/utils/i18n'
import { assistantConfirmTools } from '@/utils/settings'
import { formatShortcut } from '@/utils/shortcut'
import { useCommandShortcuts } from '@/utils/useCommandShortcuts'
import { useStorageItem } from '@/utils/useStorageItem'

import { Card, Row, SectionHeader } from './layout'

/** 设置页：侧边栏 AI 助手 */
export default function AssistantSettings() {
  const [confirmTools, setConfirmTools] = useStorageItem(assistantConfirmTools)
  const [windowId, setWindowId] = useState<number | null>(null)
  const shortcut = useCommandShortcuts()['open-assistant'] ?? ''

  useEffect(() => {
    if (chrome.sidePanel) {
      void browser.windows.getCurrent().then((win) => setWindowId(win.id ?? null))
    }
  }, [])

  // sidePanel.open 必须在点击的同步调用栈里执行，所以提前取好 windowId
  const open = () => {
    if (windowId != null) void chrome.sidePanel.open({ windowId })
  }

  return (
    <div className='flex flex-col gap-5'>
      <SectionHeader title={t('options.assistant.title')} desc={t('options.assistant.desc')} />

      <Card
        title={t('options.assistant.sidepanel.title')}
        desc={t('options.assistant.sidepanel.desc')}
      >
        <Row
          label={t('options.assistant.sidepanel.open')}
          hint={
            shortcut
              ? t('options.assistant.sidepanel.shortcutHint', {
                  shortcut: formatShortcut(shortcut),
                })
              : t('options.assistant.sidepanel.noShortcutHint')
          }
        >
          <Button onClick={open} disabled={windowId == null} className='!px-3 !py-1.5 text-sm'>
            {t('options.assistant.sidepanel.openButton')}
          </Button>
        </Row>
      </Card>

      <Card title={t('options.assistant.webmcp.title')} desc={t('options.assistant.webmcp.desc')}>
        <Row
          label={t('options.assistant.webmcp.confirm')}
          hint={t('options.assistant.webmcp.confirmHint')}
        >
          <Switch checked={confirmTools} onChange={setConfirmTools} />
        </Row>
      </Card>
    </div>
  )
}
