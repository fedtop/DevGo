/**
 * 站点工具（后台）：
 * - 按步骤编排执行：每步发给标签页的内容脚本执行；点击 / 按键 / navigate 导致页面跳转时，
 *   等新页面加载完、内容脚本就绪后接着执行剩下的步骤，所以支持跨页面的流程；
 * - 录制：录制状态按标签页存在 session 存储里，页面跳转后重新注入录制器并继续录；
 *   结束后生成草稿，打开侧边栏让用户勾选参数并保存。
 */
import { fillTemplate, type SiteToolStep } from '@/features/site-tools/types'
import type { StepResult } from '@/features/site-tools/runner'
import { injectAssistantBridge } from '@/utils/assistant-bridge'
import { t } from '@/utils/i18n'
import type {
  RecordedStep,
  RecorderStatus,
  RuntimeMessage,
  TabMessage,
  WebmcpExecuteResult,
} from '@/utils/messaging'
import {
  siteRecorderCapturePasswords,
  siteRecordingDraft,
  siteRecordings,
  sidepanelView,
  type ActiveRecording,
} from '@/utils/settings'

const PAGE_LOAD_TIMEOUT = 30_000
/** 新页面的内容脚本在 document_idle 才就绪，这段时间内重试 */
const SCRIPT_READY_TIMEOUT = 20_000
/** 点击 / 按键后留给页面开始跳转的时间 */
const NAVIGATION_GRACE_MS = 250
/** 录制时：动作之后这么久内发生的跳转视为动作引起的，不单独记成 navigate */
const ACTION_NAVIGATION_WINDOW_MS = 3000
const MAX_RESULT_CHARS = 20_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isChannelClosed = (message: string) =>
  /message channel (is )?closed|message port closed|page.*(unloaded|navigat)/i.test(message)
const isNotReady = (message: string) =>
  /Receiving end does not exist|Could not establish connection|No tab with id|Frame with ID 0/i.test(
    message,
  )

/* --------------------------------- 执行 --------------------------------- */

async function waitForLoad(tabId: number): Promise<void> {
  const deadline = Date.now() + PAGE_LOAD_TIMEOUT
  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId)
    if (tab.status === 'complete') return
    await sleep(150)
  }
}

/** 发送一步给内容脚本；页面正在跳转 / 新页面脚本没就绪时重试 */
async function sendStep(
  tabId: number,
  step: SiteToolStep,
  args: unknown,
): Promise<StepResult & { navigated?: boolean }> {
  const message: TabMessage = { type: 'site-tool-step', step, args }
  const deadline = Date.now() + SCRIPT_READY_TIMEOUT
  let injected = false
  for (;;) {
    try {
      const result = (await browser.tabs.sendMessage(tabId, message, { frameId: 0 })) as
        StepResult | undefined
      if (result) return result
      throw new Error('Receiving end does not exist')
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      // 这一步本身触发了跳转（如点击链接），旧页面带着消息通道一起关闭
      if (isChannelClosed(text)) return { ok: true, navigated: true }
      // 页面已加载完却没有接收方：标签页是扩展安装 / 更新前打开的，补注入助手桥
      if (isNotReady(text) && !injected && (await browser.tabs.get(tabId)).status === 'complete') {
        injected = true
        await injectAssistantBridge(tabId)
        continue
      }
      if (!isNotReady(text) || Date.now() > deadline) {
        return {
          ok: false,
          error: isNotReady(text) ? t('assistant.errors.scriptNotReady') : text,
        }
      }
      await sleep(200)
      await waitForLoad(tabId)
    }
  }
}

function formatResult(outputs: Record<string, unknown>): string {
  const values = Object.values(outputs)
  const result = values.length === 0 ? '已完成' : values.length === 1 ? values[0] : outputs
  const text = typeof result === 'string' ? result : JSON.stringify(result)
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text
}

/** 按步骤执行站点工具；read / fetch 的结果按 as（默认 step序号）汇总 */
export async function runSiteTool(
  tabId: number,
  steps: SiteToolStep[],
  rawArgs: unknown,
): Promise<WebmcpExecuteResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  const outputs: Record<string, unknown> = {}

  for (const [index, step] of steps.entries()) {
    const fail = (error: string): WebmcpExecuteResult => ({
      ok: false,
      error: `第 ${index + 1} 步（${step.action}${step.note ? `：${step.note}` : ''}）失败：${error}`,
    })
    try {
      if (step.action === 'navigate') {
        const tab = await browser.tabs.get(tabId)
        const url = new URL(fillTemplate(step.url, args, 'url'), tab.url || undefined).href
        await browser.tabs.update(tabId, { url })
        // 等跳转真正开始，再等加载完成
        await sleep(NAVIGATION_GRACE_MS)
        await waitForLoad(tabId)
        continue
      }

      await waitForLoad(tabId)
      const result = await sendStep(tabId, step, args)
      if (!result.ok) return fail(result.error)
      if (step.action === 'read' || step.action === 'fetch') {
        outputs[step.as || `step${index + 1}`] = result.value
      }
      // 动作可能触发跳转：留一点时间让跳转开始，下一步前会等加载完成
      if (step.action === 'click' || step.action === 'press' || result.navigated) {
        await sleep(NAVIGATION_GRACE_MS)
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  return { ok: true, result: formatResult(outputs) }
}

/* --------------------------------- 录制 --------------------------------- */

/** 录制状态的读改写串行执行：录到的步骤、结束录制、页面跳转可能同时到达 */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}

async function getRecording(tabId: number): Promise<ActiveRecording | undefined> {
  return (await siteRecordings.getValue())[String(tabId)]
}

async function setRecording(tabId: number, recording: ActiveRecording | null): Promise<void> {
  const all = { ...(await siteRecordings.getValue()) }
  if (recording) all[String(tabId)] = recording
  else delete all[String(tabId)]
  await siteRecordings.setValue(all)
}

async function injectRecorder(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ['/site-recorder.js'],
  })
}

async function status(recording: ActiveRecording | undefined): Promise<RecorderStatus | null> {
  if (!recording) return null
  return {
    stepCount: recording.steps.length,
    capturePasswords: await siteRecorderCapturePasswords.getValue(),
  }
}

export async function startRecording(tabId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const tab = await browser.tabs.get(tabId)
    if (!/^https?:/.test(tab.url ?? '')) {
      return { ok: false, error: t('assistant.recorder.unsupportedPage') }
    }
    await setRecording(tabId, {
      startUrl: tab.url ?? '',
      title: tab.title ?? '',
      steps: [],
      lastStepAt: 0,
    })
    await injectRecorder(tabId)
    return { ok: true }
  } catch (error) {
    await setRecording(tabId, null)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 同一输入框连续输入只保留最后的值；连续两次相同的点击合并 */
function appendStep(steps: RecordedStep[], step: RecordedStep): RecordedStep[] {
  const last = steps[steps.length - 1]
  if (last && last.action === 'fill' && step.action === 'fill' && last.selector === step.selector) {
    return [...steps.slice(0, -1), step]
  }
  return [...steps, step]
}

export function recordStep(
  tabId: number | undefined,
  step: RecordedStep,
): Promise<RecorderStatus | null> {
  return serial(async () => {
    if (tabId == null) return null
    const recording = await getRecording(tabId)
    if (!recording) return null
    const next = { ...recording, steps: appendStep(recording.steps, step), lastStepAt: Date.now() }
    await setRecording(tabId, next)
    return status(next)
  })
}

export async function recorderStatus(tabId: number | undefined): Promise<RecorderStatus | null> {
  return tabId == null ? null : status(await getRecording(tabId))
}

export function finishRecording(
  tabId: number | undefined,
  cancel: boolean,
): Promise<{ ok: boolean }> {
  return serial(() => finish(tabId, cancel))
}

async function finish(tabId: number | undefined, cancel: boolean): Promise<{ ok: boolean }> {
  if (tabId == null) return { ok: false }
  const recording = await getRecording(tabId)
  await setRecording(tabId, null)
  if (!recording) return { ok: false }
  if (!cancel && recording.steps.length) {
    await siteRecordingDraft.setValue({
      startUrl: recording.startUrl,
      title: recording.title,
      steps: recording.steps,
      createdAt: Date.now(),
    })
    await sidepanelView.setValue('tools')
  }
  return { ok: true }
}

function isFinishMessage(
  message: unknown,
): message is Extract<RuntimeMessage, { type: 'site-recorder-finish' }> {
  return (
    typeof message === 'object' &&
    message != null &&
    (message as RuntimeMessage).type === 'site-recorder-finish'
  )
}

/**
 * 录制相关的监听（需在后台入口同步注册）：
 * - 完成录制时打开侧边栏（必须在消息回调里同步调用，才能沿用页面上点击的用户手势）；
 * - 录制中的页面跳转：重新注入录制器；不是由录到的动作引起的跳转（如手动输入网址）记成 navigate。
 */
export function registerSiteRecorderListeners() {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isFinishMessage(message) || message.cancel) return false
    const windowId = sender.tab?.windowId
    if (windowId != null) {
      chrome.sidePanel?.open({ windowId }).catch(() => undefined)
    }
    return false
  })

  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (!info.url && info.status !== 'complete') return
    void serial(async () => {
      const recording = await getRecording(tabId)
      if (!recording) return
      if (info.url && Date.now() - recording.lastStepAt > ACTION_NAVIGATION_WINDOW_MS) {
        const last = recording.steps[recording.steps.length - 1]
        const isStart = !recording.steps.length && info.url === recording.startUrl
        if (!isStart && !(last?.action === 'navigate' && last.url === info.url)) {
          await setRecording(tabId, {
            ...recording,
            steps: [...recording.steps, { action: 'navigate', url: info.url }],
            lastStepAt: Date.now(),
          })
        }
      }
      if (info.status === 'complete') await injectRecorder(tabId).catch(() => undefined)
    })
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    void serial(async () => {
      if (await getRecording(tabId)) await setRecording(tabId, null)
    })
  })
}
