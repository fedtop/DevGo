import {
  Brain,
  Globe,
  Languages,
  MessageSquare,
  Puzzle,
  Settings,
  TextSelect,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'

import AiModelSettings from '@/features/options/AiModelSettings'
import AssistantSettings from '@/features/options/AssistantSettings'
import EnhanceSettings from '@/features/options/EnhanceSettings'
import GeneralSettings from '@/features/options/GeneralSettings'
import SelectionSettings from '@/features/options/SelectionSettings'
import NetworkSettings from '@/features/network/NetworkSettings'
import TranslateSettings from '@/features/options/TranslateSettings'
import GithubMark from '@/ui/GithubMark'
import { SHIP_NAME, SITE_URL } from '@/utils/constants'
import { t, type MessageKey } from '@/utils/i18n'

interface Section {
  id: string
  labelKey: MessageKey
  icon: LucideIcon
  component: ComponentType
}

const SECTIONS: Section[] = [
  {
    id: 'translate',
    labelKey: 'options.app.nav.translate',
    icon: Languages,
    component: TranslateSettings,
  },
  { id: 'models', labelKey: 'options.app.nav.models', icon: Brain, component: AiModelSettings },
  {
    id: 'selection',
    labelKey: 'options.app.nav.selection',
    icon: TextSelect,
    component: SelectionSettings,
  },
  {
    id: 'assistant',
    labelKey: 'options.app.nav.assistant',
    icon: MessageSquare,
    component: AssistantSettings,
  },
  { id: 'network', labelKey: 'options.app.nav.network', icon: Globe, component: NetworkSettings },
  { id: 'enhance', labelKey: 'options.app.nav.enhance', icon: Puzzle, component: EnhanceSettings },
  {
    id: 'general',
    labelKey: 'options.app.nav.general',
    icon: Settings,
    component: GeneralSettings,
  },
]

/** 已并入其他分区的旧 hash：旧书签、外部链接仍能直达对应位置 */
const LEGACY_HASHES: Record<string, string> = {
  privacy: 'network/webrtc',
}

/**
 * 当前分区记在地址的 hash 里：刷新、从其他页面直达（options.html#models）都能定位；
 * `#分区/锚点`（如 #network/webrtc）还会滚动到分区内 id 为锚点的元素
 */
function readHash(): { section: string; anchor: string } {
  const raw = location.hash.slice(1)
  const [id, anchor = ''] = (LEGACY_HASHES[raw] ?? raw).split('/')
  return SECTIONS.some((section) => section.id === id)
    ? { section: id, anchor }
    : { section: SECTIONS[0].id, anchor: '' }
}

export default function App() {
  const [{ section: current, anchor }, setLocation] = useState(readHash)

  const title = t('options.app.title', { name: SHIP_NAME })

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    const onHashChange = () => setLocation(readHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // 分区渲染后再定位：有锚点滚到锚点，否则回到顶部
  useEffect(() => {
    if (!anchor) {
      window.scrollTo({ top: 0 })
      return
    }
    // 分区内容异步加载会撑高上方区域：短时间内跟随布局变化重新定位，用户自己滚动后就不再干预
    const scrollToAnchor = () => document.getElementById(anchor)?.scrollIntoView({ block: 'start' })
    const observer = new ResizeObserver(scrollToAnchor)
    const stop = () => observer.disconnect()
    observer.observe(document.body)
    scrollToAnchor()
    const timer = window.setTimeout(stop, 1500)
    window.addEventListener('wheel', stop, { once: true })
    window.addEventListener('touchstart', stop, { once: true })
    window.addEventListener('keydown', stop, { once: true })
    return () => {
      stop()
      window.clearTimeout(timer)
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
    }
  }, [current, anchor])

  const Active = SECTIONS.find((section) => section.id === current)?.component ?? TranslateSettings

  return (
    <div className='popup-shell flex min-h-screen !max-h-none'>
      <aside className='sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-black/5 bg-[var(--ui-bg-sidebar)] px-3 py-5'>
        <div className='flex items-center gap-2 px-2.5 pb-5'>
          <img src='/icons/48.png' alt='' className='h-6 w-6' />
          <span className='text-[15px] font-semibold tracking-tight text-neutral-900'>{title}</span>
        </div>
        <nav className='flex flex-col gap-0.5'>
          {SECTIONS.map(({ id, labelKey, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={id === current ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                id === current
                  ? 'bg-black/[0.07] font-medium text-neutral-900'
                  : 'text-neutral-600 hover:bg-black/5 hover:text-neutral-900'
              }`}
            >
              <Icon className='size-4 shrink-0' strokeWidth={1.8} aria-hidden />
              {t(labelKey)}
            </a>
          ))}
        </nav>
        <a
          href={SITE_URL}
          target='_blank'
          rel='noreferrer'
          className='mt-auto flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-900'
        >
          <GithubMark className='size-4' />
          GitHub
        </a>
      </aside>

      <main className='min-w-0 flex-1 px-10 py-10'>
        <div className='mx-auto max-w-3xl'>
          <Active />
        </div>
      </main>
    </div>
  )
}
