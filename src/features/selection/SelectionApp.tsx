import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import { isChatModelReady } from '@/features/ai/model'
import type { DictResult } from '@/types/dict'
import Markdown from '@/ui/Markdown'
import { t, useLocale } from '@/utils/i18n'
import { sendRuntimeMessage, type OpenAssistantMessage } from '@/utils/messaging'
import {
  assistantLlmApiKey,
  assistantLlmConfig,
  selectionAiEnabled,
  selectionCustomActions,
  selectionHiddenBuiltinActions,
  translateLlmApiKey,
  translateLlmConfig,
} from '@/utils/settings'

import { useStorageItem } from '@/utils/useStorageItem'
import { isCustomActionKey } from '@/features/ai/actions'

import { readSelection, replaceSelection, type Rect, type SelectionSnapshot } from './selection-dom'
import {
  listToolbarActions,
  MAX_TOOLBAR_ACTIONS,
  normalizeCustomActions,
  type SelectionMode,
  type ToolbarAction,
} from './toolbar-actions'
import { useSelectionAi } from './useSelectionAi'
import {
  Check,
  ChevronDown,
  Ellipsis,
  Copy,
  GripHorizontal,
  MessageSquareText,
  Pin,
  PinOff,
  RefreshCw,
  Replace,
  Sparkles,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react'

const MAX_SELECTION_LEN = 5000
const BUBBLE_WIDTH = 400
/** 面板最大高度：固定值，滚动跟随时不随剩余空间伸缩 */
const BUBBLE_MAX_HEIGHT = 420
const TOOLBAR_HEIGHT = 36
const VIEWPORT_MARGIN = 10
/** 选区下方空间不足这个高度时，面板改放到选区上方 */
const MIN_SPACE_BELOW = 260
const Z_TOP = 2147483647
/** 结果面板顶部直接显示的模式数（另加当前模式），其余收进「更多」 */
const BUBBLE_TABS = 3

type Mode = SelectionMode

/** 面板相对选区的位置；pinned 时固定在屏幕上（拖动或点了固定），不再跟随选区 */
type BubblePlacement = { kind: 'below' | 'above' } | { kind: 'pinned'; left: number; top: number }

interface TranslateState {
  status: 'loading' | 'done' | 'error'
  text: string
  dict: DictResult | null
}

/** 判断选中文本是否为单个英文单词 / 短词（用于决定是否查词典） */
function isSingleWord(text: string): boolean {
  return /^[a-zA-Z][a-zA-Z'-]*$/.test(text)
}

/** 用浏览器 TTS 朗读文本 */
function speak(text: string, lang: string) {
  try {
    speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = lang
    utter.rate = 0.9
    speechSynthesis.speak(utter)
  } catch {
    /* 部分环境不支持，忽略 */
  }
}

/** AI 动作是否可用：开关开启，且对话模型（或沿用的翻译模型）已配置 */
function useAiAvailable(): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let active = true
    const refresh = () => {
      Promise.all([selectionAiEnabled.getValue(), isChatModelReady()])
        .then(([enabled, ready]) => active && setAvailable(enabled && ready))
        .catch(() => active && setAvailable(false))
    }
    refresh()
    const unwatchers = [
      selectionAiEnabled,
      assistantLlmConfig,
      assistantLlmApiKey,
      translateLlmConfig,
      translateLlmApiKey,
    ].map((item) => item.watch(refresh))
    return () => {
      active = false
      unwatchers.forEach((unwatch) => unwatch())
    }
  }, [])

  return available
}

/** 当前选区可用的动作：内置动作（可在设置页隐藏）+ 用户自定义动作 */
function useActionLister(aiAvailable: boolean) {
  const [hidden] = useStorageItem(selectionHiddenBuiltinActions)
  const [custom] = useStorageItem(selectionCustomActions)
  return useCallback(
    (editable: boolean) =>
      listToolbarActions({
        editable,
        aiAvailable,
        hidden: Array.isArray(hidden) ? hidden : [],
        custom: normalizeCustomActions(custom),
      }),
    [aiAvailable, hidden, custom],
  )
}

/** 面板打开期间动作在设置页被删除或隐藏：仍显示当前这一项，直到面板关闭 */
function fallbackAction(mode: Mode): ToolbarAction {
  return {
    id: mode,
    label: isCustomActionKey(mode) ? t('selection.bubble.customAction') : mode,
    title: '',
    icon: Sparkles,
    write: false,
  }
}

function clampLeft(left: number, width: number): number {
  return Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN))
}

/** 打开面板时决定放在选区下方还是上方，之后滚动只平移不翻转 */
function choosePlacement(rect: Rect): BubblePlacement {
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN
  return spaceBelow >= MIN_SPACE_BELOW || spaceBelow >= rect.top
    ? { kind: 'below' }
    : { kind: 'above' }
}

function bubbleStyle(rect: Rect, placement: BubblePlacement): CSSProperties {
  if (placement.kind === 'pinned') return { left: placement.left, top: placement.top }
  const left = clampLeft(rect.left, BUBBLE_WIDTH)
  return placement.kind === 'below'
    ? { left, top: rect.bottom + 8 }
    : { left, bottom: window.innerHeight - rect.top + 8 }
}

/** 工具条默认在选区上方（像豆包一样不挡住下文），上方放不下时放到下方 */
function toolbarStyle(rect: Rect, width: number): CSSProperties {
  const left = clampLeft(rect.left, width)
  const above = rect.top - TOOLBAR_HEIGHT - 8
  return { left, top: above >= VIEWPORT_MARGIN ? above : rect.bottom + 8 }
}

function isInViewport(rect: Rect): boolean {
  return rect.bottom > 0 && rect.top < window.innerHeight
}

/** 跟踪选区在视口里的位置：任意滚动（含内部滚动容器）或窗口缩放时重新测量 */
function useAnchorRect(snapshot: SelectionSnapshot | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(snapshot?.rect ?? null)

  useEffect(() => {
    if (!snapshot) {
      setRect(null)
      return undefined
    }
    setRect(snapshot.measure())
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setRect(snapshot.measure()))
    }
    window.addEventListener('scroll', update, { passive: true, capture: true })
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update, { capture: true })
      window.removeEventListener('resize', update)
    }
  }, [snapshot])

  return rect
}

/** 划词工具条与结果面板：翻译（引擎同翻译设置）+ AI 解释 / 总结 / 问 AI + 输入框内的润色改写 */
export default function SelectionApp() {
  // 界面语言变化时整个工具条重新渲染
  useLocale()
  const aiAvailable = useAiAvailable()
  const listActions = useActionLister(aiAvailable)
  const [toolbar, setToolbar] = useState<SelectionSnapshot | null>(null)
  const [bubble, setBubble] = useState<{ snapshot: SelectionSnapshot; mode: Mode } | null>(null)
  const [placement, setPlacement] = useState<BubblePlacement>({ kind: 'below' })
  const [translation, setTranslation] = useState<TranslateState | null>(null)
  const { result: aiResult, run: runAi, reset: resetAi } = useSelectionAi()
  const [copied, setCopied] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const translateSeqRef = useRef(0)
  const toolbarRect = useAnchorRect(toolbar)
  const bubbleRect = useAnchorRect(bubble?.snapshot ?? null)
  const pinned = placement.kind === 'pinned'

  // 事件是否发生在本扩展 UI 内部（避免点击自身按钮时清空选区）
  const isInsideUi = useCallback((e: Event) => {
    const path = e.composedPath()
    return wrapperRef.current ? path.includes(wrapperRef.current) : false
  }, [])

  const close = useCallback(() => {
    translateSeqRef.current += 1
    setToolbar(null)
    setBubble(null)
    setTranslation(null)
    resetAi()
  }, [resetAi])

  // 选区变化 -> 显示 / 隐藏工具条
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if (isInsideUi(e)) return
      const pointer = { x: e.clientX, y: e.clientY }
      // 延迟读取，等选区状态稳定
      window.setTimeout(() => {
        const snapshot = readSelection(pointer)
        if (!snapshot || snapshot.text.trim().length > MAX_SELECTION_LEN) {
          setToolbar(null)
          return
        }
        // 输入框内只提供 AI 改写；没有可用动作（AI 不可用或都被隐藏）时不打扰输入
        if (snapshot.editable && listActions(true).length === 0) {
          setToolbar(null)
          return
        }
        setToolbar(snapshot)
      }, 10)
    }

    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [isInsideUi, listActions])

  // 点击外部 / ESC -> 关闭；固定住的面板只响应 ESC 和关闭按钮
  useEffect(() => {
    if (!toolbar && !bubble) return undefined

    const onMouseDown = (e: MouseEvent) => {
      if (isInsideUi(e)) return
      if (pinned && bubble) {
        setToolbar(null)
        return
      }
      close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [toolbar, bubble, pinned, close, isInsideUi])

  const translate = async (snapshot: SelectionSnapshot) => {
    const text = snapshot.text.trim()
    const seq = (translateSeqRef.current += 1)
    setTranslation({ status: 'loading', text: '', dict: null })

    const [result, dict] = await Promise.all([
      sendRuntimeMessage({ type: 'translate', text }).catch(() => null),
      isSingleWord(text)
        ? sendRuntimeMessage({ type: 'lookup', word: text }).catch(() => null)
        : Promise.resolve(null),
    ])
    if (seq !== translateSeqRef.current) return

    setTranslation({
      status: result?.text ? 'done' : 'error',
      text:
        result?.text ||
        (result?.error
          ? t('selection.translate.failedWithDetail', { detail: result.error.message })
          : t('selection.translate.failed')),
      dict,
    })
  }

  const start = (snapshot: SelectionSnapshot, mode: Mode) => {
    setToolbar(null)
    setCopied(false)
    // 从工具条打开时按选区位置决定上下；面板里切换模式保持当前位置
    if (bubble?.snapshot !== snapshot) setPlacement(choosePlacement(snapshot.measure()))
    setBubble({ snapshot, mode })
    if (mode === 'translate') {
      resetAi()
      void translate(snapshot)
    } else {
      translateSeqRef.current += 1
      setTranslation(null)
      runAi(
        mode,
        snapshot.text.trim(),
        { paragraph: snapshot.paragraph || undefined, title: document.title, url: location.href },
        snapshot.editable ? 'input' : 'page',
      )
    }
  }

  /** 交给侧边栏助手：带上选中文字，以及气泡里已有的一轮问答 */
  const askInSidePanel = (
    snapshot: SelectionSnapshot,
    exchange?: { question: string; answer: string },
  ) => {
    const message: OpenAssistantMessage = {
      type: 'open-assistant',
      handoff: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        quote: snapshot.text.trim(),
        url: location.href,
        title: document.title,
        exchange,
      },
    }
    // 必须在点击的同步调用栈里发出：后台据此在用户手势内打开侧边栏
    browser.runtime.sendMessage(message).catch(() => undefined)
    close()
  }

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(true))
  }

  /** 固定 / 取消固定：固定时把面板钉在当前屏幕位置，不再跟随滚动 */
  const togglePin = () => {
    if (pinned) {
      if (bubble) setPlacement(choosePlacement(bubble.snapshot.measure()))
      return
    }
    const box = bubbleRef.current?.getBoundingClientRect()
    if (box) setPlacement({ kind: 'pinned', left: box.left, top: box.top })
  }

  /** 拖动面板标题栏：拖过之后面板固定在放下的位置 */
  const startDrag = (event: ReactPointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const box = bubbleRef.current?.getBoundingClientRect()
    if (!box) return
    event.preventDefault()
    const offsetX = event.clientX - box.left
    const offsetY = event.clientY - box.top
    const onMove = (e: PointerEvent) => {
      setPlacement({
        kind: 'pinned',
        left: clampLeft(e.clientX - offsetX, box.width),
        top: Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - 48)),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const replace = (snapshot: SelectionSnapshot, text: string) => {
    if (snapshot.editable && replaceSelection(snapshot.editable, text)) close()
  }

  const bubbleActions = bubble ? listActions(Boolean(bubble.snapshot.editable)) : []
  // 当前模式对应的动作；设置页里刚删掉 / 隐藏的动作仍保留在面板上直到关闭
  const currentAction = bubbleActions.find((action) => action.id === bubble?.mode)
  const allTabs =
    currentAction || !bubble ? bubbleActions : [...bubbleActions, fallbackAction(bubble.mode)]
  // 面板宽度有限：直接显示前几个和当前这一项，其余收进「更多」
  const bubbleTabs = allTabs.filter(
    (action, index) => index < BUBBLE_TABS || action.id === bubble?.mode,
  )
  const bubbleMore = allTabs.filter((action) => !bubbleTabs.includes(action))
  const writeMode = Boolean(bubble?.snapshot.editable && bubble.mode !== 'translate')

  return (
    <div
      ref={wrapperRef}
      className='text-sm leading-relaxed text-neutral-900 dark:text-neutral-100'
    >
      {toolbar && toolbarRect && isInViewport(toolbarRect) && (
        <Toolbar
          key={toolbar.text}
          rect={toolbarRect}
          actions={listActions(Boolean(toolbar.editable))}
          showAsk={aiAvailable && !toolbar.editable}
          onAction={(mode) => start(toolbar, mode)}
          onAsk={() => askInSidePanel(toolbar)}
        />
      )}

      {bubble && bubbleRect && (
        <div
          ref={bubbleRef}
          className='fixed flex flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.14)] dark:border-white/10 dark:bg-[#2a2a2a] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)]'
          style={{
            ...bubbleStyle(bubbleRect, placement),
            zIndex: Z_TOP,
            width: BUBBLE_WIDTH,
            maxHeight: BUBBLE_MAX_HEIGHT,
          }}
        >
          <div
            onPointerDown={startDrag}
            className='flex shrink-0 cursor-grab items-center gap-1 px-2.5 pt-2 pb-1.5 select-none active:cursor-grabbing'
          >
            <GripHorizontal
              className='size-3.5 shrink-0 text-neutral-300 dark:text-neutral-600'
              aria-hidden
            />
            <div className='flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]'>
              {bubbleTabs.map(({ id, label, title, icon: Icon }) => {
                const active = id === bubble.mode
                return (
                  <button
                    key={id}
                    type='button'
                    title={title}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => !active && start(bubble.snapshot, id)}
                    className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border-0 px-2 py-1 text-[13px] whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-black/[0.06] font-medium text-neutral-900 dark:bg-white/10 dark:text-white'
                        : 'bg-transparent text-neutral-500 hover:bg-black/[0.04] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-100'
                    }`}
                  >
                    <Icon className='size-3.5' aria-hidden />
                    {label}
                  </button>
                )
              })}
            </div>
            {bubbleMore.length > 0 && (
              <MoreMenu
                align='right'
                actions={bubbleMore}
                onSelect={(mode) => start(bubble.snapshot, mode)}
                trigger={(open) => (
                  <span
                    className={`flex size-7 items-center justify-center rounded-lg transition-colors ${
                      open
                        ? 'bg-black/[0.06] text-neutral-900 dark:bg-white/10 dark:text-white'
                        : 'text-neutral-400 hover:bg-black/[0.05] hover:text-neutral-800 dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-neutral-100'
                    }`}
                  >
                    <Ellipsis className='size-3.5' aria-hidden />
                  </span>
                )}
              />
            )}
            <IconButton
              label={pinned ? t('selection.bubble.unpin') : t('selection.bubble.pin')}
              active={pinned}
              onClick={togglePin}
            >
              {pinned ? <PinOff /> : <Pin />}
            </IconButton>
            <IconButton label={t('selection.bubble.close')} onClick={close}>
              <X />
            </IconButton>
          </div>

          <div className='mx-3 line-clamp-2 shrink-0 border-l-2 border-black/10 pl-2 text-xs text-neutral-500 dark:border-white/15 dark:text-neutral-400'>
            {bubble.snapshot.text.trim()}
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-2.5'>
            {bubble.mode === 'translate' ? (
              <TranslateView state={translation} source={bubble.snapshot.text.trim()} />
            ) : (
              <AiView result={aiResult} />
            )}
          </div>

          <BubbleFooter>
            {bubble.mode === 'translate' && translation?.status === 'done' && (
              <FooterButton icon={copied ? Check : Copy} onClick={() => copy(translation.text)}>
                {copied ? t('selection.bubble.copied') : t('selection.bubble.copy')}
              </FooterButton>
            )}
            {bubble.mode !== 'translate' && aiResult?.status === 'done' && (
              <>
                {!writeMode && (
                  <FooterButton
                    icon={MessageSquareText}
                    onClick={() =>
                      askInSidePanel(bubble.snapshot, {
                        question: isCustomActionKey(bubble.mode)
                          ? t('selection.bubble.followUpCustom', {
                              name: currentAction?.label ?? t('selection.bubble.customAction'),
                            })
                          : t('selection.bubble.followUpBuiltin', {
                              action: currentAction?.label ?? t('ai.actions.explain.label'),
                            }),
                        answer: aiResult.text,
                      })
                    }
                  >
                    {t('selection.bubble.followUp')}
                  </FooterButton>
                )}
                <FooterButton icon={copied ? Check : Copy} onClick={() => copy(aiResult.text)}>
                  {copied ? t('selection.bubble.copied') : t('selection.bubble.copy')}
                </FooterButton>
                {writeMode && bubble.snapshot.editable && (
                  <FooterButton
                    primary
                    icon={Replace}
                    onClick={() => replace(bubble.snapshot, aiResult.text)}
                  >
                    {t('selection.bubble.replace')}
                  </FooterButton>
                )}
              </>
            )}
            {bubble.mode !== 'translate' && aiResult?.status === 'error' && (
              <FooterButton icon={RefreshCw} onClick={() => start(bubble.snapshot, bubble.mode)}>
                {t('selection.bubble.retry')}
              </FooterButton>
            )}
          </BubbleFooter>
        </div>
      )}
    </div>
  )
}

const TOOL_BUTTON =
  'flex h-7 cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-2.5 text-[13px] whitespace-nowrap text-neutral-700 transition-colors hover:bg-black/[0.06] hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'

function Toolbar({
  rect,
  actions,
  showAsk,
  onAction,
  onAsk,
}: {
  rect: Rect
  actions: ToolbarAction[]
  showAsk: boolean
  onAction: (mode: Mode) => void
  onAsk: () => void
}) {
  const visible = actions.slice(0, MAX_TOOLBAR_ACTIONS)
  const more = actions.slice(MAX_TOOLBAR_ACTIONS)
  // 按标签长度估算宽度，用于贴边时不超出视口
  const width =
    visible.reduce((sum, action) => sum + 36 + Math.min(action.label.length, 6) * 13, 0) +
    (more.length ? 70 : 0) +
    (showAsk ? 78 : 0) +
    8

  return (
    <div
      // 阻止 mousedown 的默认行为：点击工具条不让输入框失焦、不清掉选区
      onMouseDown={(event) => event.preventDefault()}
      className='fixed flex items-center gap-0.5 rounded-full border border-black/[0.08] bg-white p-1 shadow-[0_6px_20px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#2a2a2a] dark:shadow-[0_6px_20px_rgba(0,0,0,0.45)]'
      style={{ ...toolbarStyle(rect, width), zIndex: Z_TOP, height: TOOLBAR_HEIGHT }}
    >
      {visible.map(({ id, label, title, icon: Icon }) => (
        <button
          key={id}
          type='button'
          title={title}
          onClick={() => onAction(id)}
          className={TOOL_BUTTON}
        >
          <Icon className='size-3.5 shrink-0' aria-hidden />
          <span className='max-w-[6.5em] truncate'>{label}</span>
        </button>
      ))}
      {more.length > 0 && (
        <MoreMenu
          actions={more}
          onSelect={onAction}
          trigger={(open) => (
            <span className={`${TOOL_BUTTON} ${open ? '!bg-black/[0.06] dark:!bg-white/10' : ''}`}>
              {t('selection.toolbar.more')}
              <ChevronDown
                className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </span>
          )}
        />
      )}
      {showAsk && (
        <>
          {actions.length > 0 && (
            <span className='mx-0.5 h-4 w-px bg-black/10 dark:bg-white/15' aria-hidden />
          )}
          <button
            type='button'
            title={t('selection.toolbar.askTitle')}
            onClick={onAsk}
            className={TOOL_BUTTON}
          >
            <MessageSquareText className='size-3.5' aria-hidden />
            {t('selection.toolbar.ask')}
          </button>
        </>
      )}
    </div>
  )
}

/** 「更多」下拉：工具条和结果面板放不下的动作 */
function MoreMenu({
  actions,
  onSelect,
  trigger,
  title,
  align = 'left',
}: {
  align?: 'left' | 'right'
  actions: ToolbarAction[]
  onSelect: (mode: Mode) => void
  trigger: (open: boolean) => ReactNode
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const menuLabel = title ?? t('selection.toolbar.moreActions')
  return (
    <div className='relative shrink-0'>
      <button
        type='button'
        title={menuLabel}
        aria-label={menuLabel}
        aria-haspopup='menu'
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className='flex cursor-pointer border-0 bg-transparent p-0'
      >
        {trigger(open)}
      </button>
      {open && (
        <div
          role='menu'
          className={`absolute top-full z-10 mt-2 flex max-h-60 ${align === 'left' ? 'left-0' : 'right-0'} min-w-40 flex-col overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-1 shadow-[0_10px_30px_rgba(0,0,0,0.14)] dark:border-white/10 dark:bg-[#2a2a2a] dark:shadow-[0_10px_30px_rgba(0,0,0,0.5)]`}
        >
          {actions.map(({ id, label, title: hint, icon: Icon }) => (
            <button
              key={id}
              type='button'
              role='menuitem'
              title={hint}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setOpen(false)
                onSelect(id)
              }}
              className='flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] whitespace-nowrap text-neutral-700 transition-colors hover:bg-black/[0.05] hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white'
            >
              <Icon className='size-3.5 shrink-0' aria-hidden />
              <span className='max-w-[14em] truncate'>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function IconButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type='button'
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 transition-colors [&_svg]:size-3.5 ${
        active
          ? 'bg-black/[0.06] text-neutral-900 dark:bg-white/10 dark:text-white'
          : 'bg-transparent text-neutral-400 hover:bg-black/[0.05] hover:text-neutral-800 dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-neutral-100'
      }`}
    >
      {children}
    </button>
  )
}

function TranslateView({ state, source }: { state: TranslateState | null; source: string }) {
  if (!state || state.status === 'loading') {
    return (
      <p className='animate-pulse text-neutral-500 dark:text-neutral-400'>
        {t('selection.translate.loading')}
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-1.5'>
      {state.status === 'done' && state.dict && (
        <div className='flex items-center gap-1.5'>
          <span className='font-semibold'>{state.dict.word}</span>
          <button
            type='button'
            title={t('selection.translate.speak')}
            onClick={() => speak(source, 'en-US')}
            className='flex cursor-pointer border-0 bg-transparent p-0 text-neutral-400 hover:text-neutral-800 dark:hover:text-white'
          >
            <Volume2 className='size-3.5' aria-hidden />
          </button>
        </div>
      )}
      <p
        className={`text-[14px] ${state.status === 'error' ? 'text-rose-600 dark:text-rose-400' : ''}`}
      >
        {state.text}
      </p>
      {state.status === 'done' && state.dict && state.dict.entries.length > 0 && (
        <div className='text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300'>
          {state.dict.entries.map((entry) => (
            <div key={entry.pos || 'misc'} className='flex gap-1.5'>
              {entry.pos && <span className='shrink-0 text-neutral-400 italic'>{entry.pos}.</span>}
              <span>{entry.terms.join('；')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AiView({ result }: { result: ReturnType<typeof useSelectionAi>['result'] }) {
  if (!result) return null
  if (result.status === 'error') {
    return <p className='text-rose-600 dark:text-rose-400'>{result.error}</p>
  }
  if (result.status === 'loading') {
    return (
      <div className='flex flex-col gap-1'>
        <p className='animate-pulse text-neutral-500 dark:text-neutral-400'>
          {result.reasoning ? t('selection.ai.thinking') : t('selection.ai.generating')}
        </p>
        {result.reasoning && (
          <p className='line-clamp-3 text-xs text-neutral-400'>{result.reasoning.slice(-240)}</p>
        )}
      </div>
    )
  }
  return <Markdown text={result.text} className='text-[13.5px]' />
}

function BubbleFooter({ children }: { children: ReactNode }) {
  return (
    <div className='flex shrink-0 justify-end gap-1.5 border-t border-black/[0.06] px-3 py-2 empty:hidden dark:border-white/10'>
      {children}
    </div>
  )
}

function FooterButton({
  primary = false,
  icon: Icon,
  onClick,
  children,
}: {
  primary?: boolean
  icon: LucideIcon
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type='button'
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1 rounded-full border-0 px-3 py-1 text-xs transition-colors ${
        primary
          ? 'bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white'
          : 'bg-black/[0.05] text-neutral-700 hover:bg-black/[0.09] dark:bg-white/10 dark:text-neutral-200 dark:hover:bg-white/15'
      }`}
    >
      <Icon className='size-3.5' aria-hidden />
      {children}
    </button>
  )
}
