import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import {
  isWriteAction,
  READ_ACTIONS,
  SELECTION_AI_ACTIONS,
  WRITE_ACTIONS,
  type SelectionAiAction,
} from '@/features/ai/actions'
import { isChatModelReady } from '@/features/ai/model'
import type { DictResult } from '@/types/dict'
import Markdown from '@/ui/Markdown'
import { sendRuntimeMessage, type OpenAssistantMessage } from '@/utils/messaging'
import {
  assistantLlmApiKey,
  assistantLlmConfig,
  selectionAiEnabled,
  translateLlmApiKey,
  translateLlmConfig,
} from '@/utils/settings'

import { readSelection, replaceSelection, type Rect, type SelectionSnapshot } from './selection-dom'
import { useSelectionAi } from './useSelectionAi'
import {
  BookOpen,
  Briefcase,
  Check,
  Copy,
  GripHorizontal,
  Languages,
  ListChecks,
  MessageSquareText,
  Pin,
  PinOff,
  RefreshCw,
  Replace,
  SpellCheck,
  Volume2,
  WandSparkles,
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

type Mode = 'translate' | SelectionAiAction

const MODE_META: Record<Mode, { label: string; title: string; icon: LucideIcon }> = {
  translate: { label: '翻译', title: '翻译选中文本', icon: Languages },
  explain: { ...SELECTION_AI_ACTIONS.explain, icon: BookOpen },
  summarize: { ...SELECTION_AI_ACTIONS.summarize, icon: ListChecks },
  polish: { ...SELECTION_AI_ACTIONS.polish, icon: WandSparkles },
  fix: { ...SELECTION_AI_ACTIONS.fix, icon: SpellCheck },
  formal: { ...SELECTION_AI_ACTIONS.formal, icon: Briefcase },
}

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
  const aiAvailable = useAiAvailable()
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
        // 输入框内只提供 AI 改写；AI 不可用时不打扰输入
        if (snapshot.editable && !aiAvailable) {
          setToolbar(null)
          return
        }
        setToolbar(snapshot)
      }, 10)
    }

    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [isInsideUi, aiAvailable])

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
          ? `翻译失败：${result.error.message}`
          : '翻译失败，请检查网络或切换翻译引擎'),
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
      runAi(mode, snapshot.text.trim(), {
        paragraph: snapshot.paragraph || undefined,
        title: document.title,
        url: location.href,
      })
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

  const bubbleModes: Mode[] = bubble?.snapshot.editable
    ? WRITE_ACTIONS
    : ['translate', ...READ_ACTIONS]

  return (
    <div
      ref={wrapperRef}
      className='text-sm leading-relaxed text-neutral-900 dark:text-neutral-100'
    >
      {toolbar && toolbarRect && isInViewport(toolbarRect) && (
        <Toolbar
          snapshot={toolbar}
          rect={toolbarRect}
          aiAvailable={aiAvailable}
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
            <div className='flex min-w-0 flex-1 gap-0.5'>
              {(aiAvailable ? bubbleModes : [bubble.mode]).map((mode) => {
                const { label, icon: Icon } = MODE_META[mode]
                const active = mode === bubble.mode
                return (
                  <button
                    key={mode}
                    type='button'
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => !active && start(bubble.snapshot, mode)}
                    className={`flex cursor-pointer items-center gap-1 rounded-lg border-0 px-2 py-1 text-[13px] transition-colors ${
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
            <IconButton
              label={pinned ? '取消固定' : '固定面板（不随页面滚动、点击外部不关闭）'}
              active={pinned}
              onClick={togglePin}
            >
              {pinned ? <PinOff /> : <Pin />}
            </IconButton>
            <IconButton label='关闭' onClick={close}>
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
                {copied ? '已复制' : '复制'}
              </FooterButton>
            )}
            {bubble.mode !== 'translate' && aiResult?.status === 'done' && (
              <>
                {!isWriteAction(bubble.mode) && (
                  <FooterButton
                    icon={MessageSquareText}
                    onClick={() =>
                      askInSidePanel(bubble.snapshot, {
                        question: `${SELECTION_AI_ACTIONS[bubble.mode as SelectionAiAction].label}这段内容`,
                        answer: aiResult.text,
                      })
                    }
                  >
                    继续追问
                  </FooterButton>
                )}
                <FooterButton icon={copied ? Check : Copy} onClick={() => copy(aiResult.text)}>
                  {copied ? '已复制' : '复制'}
                </FooterButton>
                {isWriteAction(bubble.mode) && bubble.snapshot.editable && (
                  <FooterButton
                    primary
                    icon={Replace}
                    onClick={() => replace(bubble.snapshot, aiResult.text)}
                  >
                    替换原文
                  </FooterButton>
                )}
              </>
            )}
            {bubble.mode !== 'translate' && aiResult?.status === 'error' && (
              <FooterButton icon={RefreshCw} onClick={() => start(bubble.snapshot, bubble.mode)}>
                重试
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
  snapshot,
  rect,
  aiAvailable,
  onAction,
  onAsk,
}: {
  snapshot: SelectionSnapshot
  rect: Rect
  aiAvailable: boolean
  onAction: (mode: Mode) => void
  onAsk: () => void
}) {
  const modes: Mode[] = !aiAvailable
    ? ['translate']
    : snapshot.editable
      ? WRITE_ACTIONS
      : ['translate', ...READ_ACTIONS]
  const showAsk = aiAvailable && !snapshot.editable
  // 按钮数量估算宽度，用于贴边时不超出视口
  const width = modes.length * 68 + (showAsk ? 78 : 0) + 8

  return (
    <div
      // 阻止 mousedown 的默认行为：点击工具条不让输入框失焦、不清掉选区
      onMouseDown={(event) => event.preventDefault()}
      className='fixed flex items-center gap-0.5 rounded-full border border-black/[0.08] bg-white p-1 shadow-[0_6px_20px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#2a2a2a] dark:shadow-[0_6px_20px_rgba(0,0,0,0.45)]'
      style={{ ...toolbarStyle(rect, width), zIndex: Z_TOP, height: TOOLBAR_HEIGHT }}
    >
      {modes.map((mode) => {
        const { label, title, icon: Icon } = MODE_META[mode]
        return (
          <button
            key={mode}
            type='button'
            title={title}
            onClick={() => onAction(mode)}
            className={TOOL_BUTTON}
          >
            <Icon className='size-3.5' aria-hidden />
            {label}
          </button>
        )
      })}
      {showAsk && (
        <>
          <span className='mx-0.5 h-4 w-px bg-black/10 dark:bg-white/15' aria-hidden />
          <button
            type='button'
            title='在侧边栏里就选中内容提问'
            onClick={onAsk}
            className={TOOL_BUTTON}
          >
            <MessageSquareText className='size-3.5' aria-hidden />问 AI
          </button>
        </>
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
    return <p className='animate-pulse text-neutral-500 dark:text-neutral-400'>翻译中…</p>
  }

  return (
    <div className='flex flex-col gap-1.5'>
      {state.status === 'done' && state.dict && (
        <div className='flex items-center gap-1.5'>
          <span className='font-semibold'>{state.dict.word}</span>
          <button
            type='button'
            title='朗读'
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
          {result.reasoning ? '思考中…' : '生成中…'}
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
