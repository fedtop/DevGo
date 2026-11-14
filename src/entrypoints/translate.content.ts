import { PageTranslationController } from '@/features/translate/page/controller'
import { hasExtensionRuntime } from '@/utils/content-settings'
import { initI18n } from '@/utils/i18n'
import type { TabMessage, TabResponseMap } from '@/utils/messaging'
import { setNotranslateNode } from '@/utils/no-translate'

/**
 * 整页翻译 / 悬停翻译入口。引擎实现见 src/features/translate/page/。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main(ctx) {
    if (!hasExtensionRuntime()) return
    // 出错提示条、重试按钮等页面内文案依赖界面语言，先读取设置
    await initI18n()

    const controller = new PageTranslationController()
    ctx.onInvalidated(() => controller.destroy())

    browser.runtime.onMessage.addListener((message: TabMessage, _sender, sendResponse) => {
      const respond = (state: TabResponseMap['get-page-translation-state']) => sendResponse(state)
      switch (message?.type) {
        case 'translate-page':
          // 已翻译则恢复原文（toggle）
          respond(controller.toggle())
          break
        case 'set-page-translation':
          respond(controller.setEnabled(message.enabled))
          break
        case 'get-page-translation-state':
          respond(controller.state)
          break
        case 'tip':
          alert(message.msg)
          break
        default:
          // collect-media-resources 由 media.content.ts 响应
          break
      }
      return undefined
    })

    // 标记浏览器自带翻译需要忽略的元素（与 DevGo 引擎无关）
    setNotranslateNode()

    await controller.init()
  },
})
