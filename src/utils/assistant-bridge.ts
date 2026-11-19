/**
 * 助手桥（assistant.content.ts）的消息发送：标签页里还没有这个内容脚本时，补注入后再发一次。
 *
 * 声明式内容脚本只会注入到之后加载的页面：扩展安装、更新或重新加载之前就打开的标签页里没有它
 * （旧版本留下的脚本已与扩展断开，收不到消息），不刷新网页就会出现
 * 「Receiving end does not exist」。这里按需用 scripting 注入一次，用户不必手动刷新。
 */
import type { TabMessage } from '@/utils/messaging'

const BRIDGE_FILE = '/content-scripts/assistant.js'

export function isMissingReceiver(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Receiving end does not exist|Could not establish connection/i.test(message)
}

/** 把助手桥注入到标签页的所有 frame；页面不允许注入（浏览器内置页等）时返回 false */
export async function injectAssistantBridge(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [BRIDGE_FILE],
    })
    return true
  } catch {
    return false
  }
}

/** 给标签页的指定 frame 发消息；没有接收方时补注入助手桥再重试一次 */
export async function sendToAssistant<T>(
  tabId: number,
  message: TabMessage,
  frameId = 0,
): Promise<T> {
  try {
    return (await browser.tabs.sendMessage(tabId, message, { frameId })) as T
  } catch (error) {
    if (!isMissingReceiver(error) || !(await injectAssistantBridge(tabId))) throw error
    return (await browser.tabs.sendMessage(tabId, message, { frameId })) as T
  }
}
