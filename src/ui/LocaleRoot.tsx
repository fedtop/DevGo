import { Fragment, type ReactNode } from 'react'

import { useLocale } from '@/utils/i18n'

/** 扩展页面根组件：切换界面语言时整体重新挂载，让所有文案（含 memo 过的）都换成新语言 */
export default function LocaleRoot({ children }: { children: ReactNode }) {
  const locale = useLocale()
  return <Fragment key={locale}>{children}</Fragment>
}
