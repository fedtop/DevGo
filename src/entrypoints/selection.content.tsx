import ReactDOM from 'react-dom/client'

import SelectionApp from '@/features/selection/SelectionApp'
import {
  getLocalBooleanSetting,
  getLocalStringListSetting,
  hasExtensionRuntime,
  watchLocalSetting,
} from '@/utils/content-settings'
import '@/features/selection/style.css'

const ENABLE_SELECTION_TRANSLATE_KEY = 'enableSelectionTranslate'
const SELECTION_DISABLED_HOSTS_KEY = 'selectionDisabledHosts'

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    if (!hasExtensionRuntime()) return

    const ui = await createShadowRootUi(ctx, {
      name: 'devgo-selection-ui',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        // 渲染到独立子节点，避免 React 直接挂载到 body 容器的告警
        const app = document.createElement('div')
        container.append(app)
        const root = ReactDOM.createRoot(app)
        root.render(<SelectionApp />)
        return root
      },
      onRemove(root) {
        root?.unmount()
      },
    })

    // 全局开关 + 本站是否停用，二者都允许才挂载；设置变化时动态启停
    let mounted = false
    const sync = async () => {
      const [enabled, disabledHosts] = await Promise.all([
        getLocalBooleanSetting(ENABLE_SELECTION_TRANSLATE_KEY, true),
        getLocalStringListSetting(SELECTION_DISABLED_HOSTS_KEY),
      ])
      const next = enabled && !disabledHosts.includes(location.hostname)
      if (next === mounted) return
      mounted = next
      if (next) ui.mount()
      else ui.remove()
    }

    await sync()
    const unwatchEnabled = watchLocalSetting(ENABLE_SELECTION_TRANSLATE_KEY, () => void sync())
    const unwatchHosts = watchLocalSetting(SELECTION_DISABLED_HOSTS_KEY, () => void sync())
    const unwatch = () => {
      unwatchEnabled()
      unwatchHosts()
    }
    ctx.onInvalidated(unwatch)
  },
})
