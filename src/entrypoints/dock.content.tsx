import ReactDOM from 'react-dom/client'

import DockApp from '@/features/dock/DockApp'
import { DOCK_SESSION_HIDDEN_KEY } from '@/features/dock/model'
import { hasExtensionRuntime } from '@/utils/content-settings'
import { initI18n } from '@/utils/i18n'
import { dockDisabledHosts, dockEnabled } from '@/utils/settings'
import '@/features/dock/style.css'

/** 页面右侧的悬浮快捷栏：只在顶层页面显示，可全局关闭、按站点关闭或本次不显示 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    if (!hasExtensionRuntime() || window.top !== window) return
    await initI18n()

    const ui = await createShadowRootUi(ctx, {
      name: 'devgo-dock-ui',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const app = document.createElement('div')
        container.append(app)
        const root = ReactDOM.createRoot(app)
        root.render(<DockApp onHideSession={hideForSession} />)
        return root
      },
      onRemove(root) {
        root?.unmount()
      },
    })

    let mounted = false
    const sync = async () => {
      const [enabled, hosts] = await Promise.all([
        dockEnabled.getValue(),
        dockDisabledHosts.getValue(),
      ])
      const hiddenThisSession = sessionStorage.getItem(DOCK_SESSION_HIDDEN_KEY) === '1'
      const next = enabled && !hosts.includes(location.hostname) && !hiddenThisSession
      if (next === mounted) return
      mounted = next
      if (next) ui.mount()
      else ui.remove()
    }

    // 「本次不显示」：记在本标签页的 sessionStorage，关闭标签页后恢复
    function hideForSession() {
      sessionStorage.setItem(DOCK_SESSION_HIDDEN_KEY, '1')
      void sync()
    }

    await sync()
    const unwatchers = [
      dockEnabled.watch(() => void sync()),
      dockDisabledHosts.watch(() => void sync()),
    ]
    ctx.onInvalidated(() => unwatchers.forEach((unwatch) => unwatch()))
  },
})
