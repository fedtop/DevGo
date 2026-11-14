import {
  ArrowUp,
  EyeOff,
  Languages,
  MessageSquareText,
  Power,
  Settings,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { t, useLocale } from '@/utils/i18n'
import { sendRuntimeMessage, type OpenAssistantMessage } from '@/utils/messaging'
import { dockDisabledHosts, dockEnabled, dockPositionY } from '@/utils/settings'

const Z_DOCK = 2147483646
const BALL_SIZE = 40
/** 拖动超过这个距离才算拖动，否则当作点击 */
const DRAG_THRESHOLD = 4

/** DevGo 标志（与扩展图标同形：一个圆点 + 一道弧形竖笔） */
function DevGoMark({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 48 48' className={className} aria-hidden='true'>
      <circle cx='15' cy='35' r='8' fill='#3ccff4' />
      <path d='M24 21c0-8 4-14 13-16v30c0 4-3 7-7 7h-6z' fill='#5865f2' />
    </svg>
  )
}

function openAssistant(prompt?: string) {
  const message: OpenAssistantMessage = {
    type: 'open-assistant',
    handoff: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      quote: '',
      url: location.href,
      title: document.title,
      prompt,
    },
  }
  // 必须在点击的同步调用栈里发出：后台据此在用户手势内打开侧边栏
  browser.runtime.sendMessage(message).catch(() => undefined)
}

/** 页面右侧悬浮快捷栏：悬停展开常用操作，可拖动调整高度，可按本次 / 本站 / 永久关闭 */
export default function DockApp({ onHideSession }: { onHideSession: () => void }) {
  useLocale()
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [ratio, setRatio] = useState<number | null>(null)
  const [dragY, setDragY] = useState<number | null>(null)
  const [translating, setTranslating] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const collapseTimer = useRef<number>()
  const draggedRef = useRef(false)

  useEffect(() => {
    void dockPositionY.getValue().then(setRatio)
    void sendRuntimeMessage({ type: 'dock-page-translation', action: 'state' })
      .then((state) => setTranslating(Boolean(state?.active)))
      .catch(() => undefined)
    const onScroll = () => setScrolled(window.scrollY > 400)
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement))
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('fullscreenchange', onFullscreen)
    }
  }, [])

  if (ratio === null || fullscreen) return null

  const top = Math.round(
    dragY ??
      Math.min(Math.max(ratio * window.innerHeight, 16), window.innerHeight - BALL_SIZE - 16),
  )

  const open = () => {
    window.clearTimeout(collapseTimer.current)
    setExpanded(true)
  }
  const scheduleCollapse = () => {
    window.clearTimeout(collapseTimer.current)
    collapseTimer.current = window.setTimeout(() => {
      setExpanded(false)
      setMenuOpen(false)
    }, 280)
  }

  const startDrag = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    const startY = event.clientY
    const startTop = top
    draggedRef.current = false
    const onMove = (e: PointerEvent) => {
      const delta = e.clientY - startY
      if (!draggedRef.current && Math.abs(delta) < DRAG_THRESHOLD) return
      draggedRef.current = true
      setDragY(Math.min(Math.max(startTop + delta, 16), window.innerHeight - BALL_SIZE - 16))
    }
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!draggedRef.current) return
      const finalTop = Math.min(
        Math.max(startTop + e.clientY - startY, 16),
        window.innerHeight - BALL_SIZE - 16,
      )
      const next = finalTop / window.innerHeight
      setRatio(next)
      setDragY(null)
      void dockPositionY.setValue(next)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const toggleTranslate = () => {
    void sendRuntimeMessage({ type: 'dock-page-translation', action: 'toggle' })
      .then((state) => setTranslating(Boolean(state?.active)))
      .catch(() => undefined)
  }

  const hideOnSite = () => {
    void dockDisabledHosts
      .getValue()
      .then((hosts) => dockDisabledHosts.setValue([...new Set([...hosts, location.hostname])]))
  }

  const actions: Array<{
    key: string
    label: string
    icon: LucideIcon
    active?: boolean
    run: () => void
  }> = [
    {
      key: 'translate',
      label: translating ? t('dock.actions.showOriginal') : t('dock.actions.translatePage'),
      icon: Languages,
      active: translating,
      run: toggleTranslate,
    },
    {
      key: 'summary',
      label: t('dock.actions.summarize'),
      icon: Sparkles,
      run: () => openAssistant(t('assistant.quickActions.summarize.prompt')),
    },
    {
      key: 'assistant',
      label: t('dock.actions.assistant'),
      icon: MessageSquareText,
      run: () => openAssistant(),
    },
    ...(scrolled
      ? [
          {
            key: 'top',
            label: t('dock.actions.backToTop'),
            icon: ArrowUp,
            run: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
          },
        ]
      : []),
    {
      key: 'settings',
      label: t('dock.actions.settings'),
      icon: Settings,
      run: () => void sendRuntimeMessage({ type: 'open-options-page' }).catch(() => undefined),
    },
  ]

  const surface =
    'border border-black/[0.08] bg-white shadow-[0_6px_20px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#2a2a2a] dark:shadow-[0_6px_20px_rgba(0,0,0,0.45)]'

  return (
    <div
      className='fixed right-0 flex flex-col items-end font-sans text-[13px] leading-normal text-neutral-800 dark:text-neutral-100'
      style={{ top, zIndex: Z_DOCK }}
      onPointerEnter={open}
      onPointerLeave={scheduleCollapse}
    >
      <div
        className='relative flex items-center transition-transform duration-200 ease-out'
        style={{ transform: expanded || dragY !== null ? 'translateX(-10px)' : 'translateX(10px)' }}
      >
        {/* 关闭入口：悬停时出现在圆球左上角 */}
        {expanded && dragY === null && (
          <button
            type='button'
            title={t('dock.close.button')}
            aria-label={t('dock.close.button')}
            onClick={() => setMenuOpen((value) => !value)}
            className='absolute -top-1.5 -left-1.5 z-10 flex size-[18px] cursor-pointer items-center justify-center rounded-full border-0 bg-neutral-500/80 p-0 text-white transition-colors hover:bg-neutral-700'
          >
            <X className='size-3' strokeWidth={2.4} aria-hidden />
          </button>
        )}
        <button
          type='button'
          title={t('dock.ball.title')}
          aria-label={t('dock.ball.ariaLabel')}
          aria-expanded={expanded}
          onPointerDown={startDrag}
          onClick={() => {
            if (draggedRef.current) return
            setExpanded((value) => !value)
            setMenuOpen(false)
          }}
          className={`flex cursor-grab touch-none items-center justify-center rounded-full p-0 transition-opacity active:cursor-grabbing ${surface} ${
            expanded ? 'opacity-100' : 'opacity-80'
          }`}
          style={{ width: BALL_SIZE, height: BALL_SIZE }}
        >
          <DevGoMark className='size-6' />
        </button>

        {menuOpen && (
          <div
            className={`absolute top-0 right-full mr-2 w-56 rounded-xl p-1 ${surface}`}
            role='menu'
          >
            <MenuItem
              icon={EyeOff}
              title={t('dock.close.session.title')}
              desc={t('dock.close.session.desc')}
              onClick={onHideSession}
            />
            <MenuItem
              icon={X}
              title={t('dock.close.site.title', { host: location.hostname })}
              desc={t('dock.close.site.desc')}
              onClick={hideOnSite}
            />
            <MenuItem
              icon={Power}
              title={t('dock.close.all.title')}
              desc={t('dock.close.all.desc')}
              onClick={() => void dockEnabled.setValue(false)}
            />
          </div>
        )}
      </div>

      {expanded && dragY === null && (
        <div className={`mt-2 mr-[10px] flex flex-col gap-0.5 rounded-full p-1 ${surface}`}>
          {actions.map(({ key, label, icon: Icon, active, run }) => (
            <button
              key={key}
              type='button'
              title={label}
              aria-label={label}
              onClick={run}
              className={`group relative flex size-8 cursor-pointer items-center justify-center rounded-full border-0 p-0 transition-colors ${
                active
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'bg-transparent text-neutral-600 hover:bg-black/[0.06] hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
              }`}
            >
              <Icon className='size-4' strokeWidth={1.8} aria-hidden />
              <span className='pointer-events-none absolute right-full mr-2 rounded-md bg-neutral-900 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-neutral-100 dark:text-neutral-900'>
                {label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  icon: LucideIcon
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      role='menuitem'
      onClick={onClick}
      className='flex w-full cursor-pointer items-start gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left transition-colors hover:bg-black/[0.05] dark:hover:bg-white/10'
    >
      <Icon className='mt-0.5 size-3.5 shrink-0 text-neutral-500' aria-hidden />
      <span className='min-w-0'>
        <span className='block truncate text-[13px] text-neutral-900 dark:text-neutral-100'>
          {title}
        </span>
        <span className='block text-[11px] text-neutral-500'>{desc}</span>
      </span>
    </button>
  )
}
