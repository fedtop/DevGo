/**
 * 网页导出的权限：Chrome 截取视口外的部分要用 debugger（可选权限，首次使用时申请）；
 * Firefox 有 tabs.captureTab，不需要额外权限。
 */

import type { CaptureRect } from '@/utils/messaging'

/** Firefox 有 tabs.captureTab（可按页面坐标截取视口外区域），Chrome 没有 */
export type CaptureTab = (
  tabId: number,
  options: { format: 'png'; rect: CaptureRect; scale: number },
) => Promise<string>

export function getCaptureTab(): CaptureTab | undefined {
  return (browser.tabs as unknown as { captureTab?: CaptureTab }).captureTab
}

/**
 * 申请截取所需的权限。必须在用户手势（点击按钮 / 右键菜单）的同步调用栈里、任何 await 之前调用。
 * Firefox 用 tabs.captureTab，不需要额外权限。
 */
export function requestCapturePermission(): Promise<boolean> {
  if (getCaptureTab()) return Promise.resolve(true)
  return browser.permissions.request({ permissions: ['debugger'] })
}
