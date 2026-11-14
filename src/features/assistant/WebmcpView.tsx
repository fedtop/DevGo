import {
  ChevronDown,
  CircleAlert,
  FlaskConical,
  Frame,
  Loader2,
  Play,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import Button from '@/ui/Button'
import IconButton from '@/ui/IconButton'
import type { WebmcpExecuteResult } from '@/utils/messaging'

import { templateFromSchema } from './schema-template'
import type { FrameTool, ToolsStatus } from './webmcp-client'

interface WebmcpViewProps {
  tools: FrameTool[]
  status: ToolsStatus
  onRefresh: () => void
  execute: (tool: FrameTool, args: unknown) => Promise<WebmcpExecuteResult>
}

const toolKey = (tool: FrameTool) => `${tool.frameId}:${tool.name}`

/**
 * 侧边栏「网页工具」页：列出当前网页通过 WebMCP 注册的工具，查看说明、手动填参数执行
 * （调试网页的 WebMCP 实现时很有用）。AI 对话里会自动调用这些工具，不需要先在这里执行。
 */
export default function WebmcpView({ tools, status, onRefresh, execute }: WebmcpViewProps) {
  const [selected, setSelected] = useState<string | null>(null)

  if (status === 'unsupported') {
    return (
      <EmptyState icon={FlaskConical} title='浏览器还没开启 WebMCP'>
        WebMCP 目前是 Chrome 的实验功能：需要 Chrome 150 及以上，在 chrome://flags 搜索「WebMCP for
        testing」并启用，重启浏览器后回到这里刷新。
      </EmptyState>
    )
  }
  if (status === 'unavailable') {
    return (
      <EmptyState icon={CircleAlert} title='当前页面读取不到' onRefresh={onRefresh}>
        浏览器内置页、扩展商店等页面不允许扩展访问；如果是普通网页，刷新网页后再试。
      </EmptyState>
    )
  }
  if (status === 'loading') {
    return (
      <EmptyState icon={Loader2} spin title='正在检测当前网页…'>
        读取网页及其中 iframe 注册的工具。
      </EmptyState>
    )
  }
  if (tools.length === 0) {
    return (
      <EmptyState icon={PlugZap} title='这个网页没有提供工具' onRefresh={onRefresh}>
        网页需要通过 WebMCP（document.modelContext）注册工具，AI 才能直接替你操作网页。
      </EmptyState>
    )
  }

  return (
    <div className='min-h-0 flex-1 overflow-y-auto px-3 py-3'>
      <div className='mb-2 flex items-center justify-between gap-2 px-0.5'>
        <p className='text-xs text-neutral-500'>
          当前网页提供 {tools.length} 个工具，在「对话」里描述需求，AI 会自动调用
        </p>
        <IconButton label='重新检测' onClick={onRefresh} className='!size-7 [&_svg]:!size-3.5'>
          <RefreshCw strokeWidth={1.8} />
        </IconButton>
      </div>
      <ul className='flex flex-col gap-2'>
        {tools.map((tool) => (
          <ToolCard
            key={toolKey(tool)}
            tool={tool}
            expanded={selected === toolKey(tool)}
            onToggle={() =>
              setSelected((current) => (current === toolKey(tool) ? null : toolKey(tool)))
            }
            execute={execute}
          />
        ))}
      </ul>
    </div>
  )
}

function EmptyState({
  icon: Icon,
  spin = false,
  title,
  onRefresh,
  children,
}: {
  icon: LucideIcon
  spin?: boolean
  title: string
  onRefresh?: () => void
  children: ReactNode
}) {
  return (
    <div className='flex min-h-0 flex-1 flex-col items-center gap-3 px-6 pt-14 text-center'>
      <span className='flex size-10 items-center justify-center rounded-full bg-black/5 text-neutral-600'>
        <Icon className={`size-5 ${spin ? 'animate-spin' : ''}`} strokeWidth={1.8} aria-hidden />
      </span>
      <p className='text-sm font-semibold text-neutral-900'>{title}</p>
      <p className='text-xs leading-relaxed text-neutral-500'>{children}</p>
      {onRefresh && (
        <Button onClick={onRefresh} className='mt-1 !px-3 !py-1 text-xs'>
          <RefreshCw className='size-3.5' aria-hidden />
          重新检测
        </Button>
      )}
    </div>
  )
}

function Badge({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'safe' | 'warn' | 'plain'
  icon?: LucideIcon
  children: ReactNode
}) {
  const color =
    tone === 'safe'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-black/5 text-neutral-600'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] ${color}`}
    >
      {Icon && <Icon className='size-3' aria-hidden />}
      {children}
    </span>
  )
}

function ToolCard({
  tool,
  expanded,
  onToggle,
  execute,
}: {
  tool: FrameTool
  expanded: boolean
  onToggle: () => void
  execute: WebmcpViewProps['execute']
}) {
  const [args, setArgs] = useState(() =>
    JSON.stringify(templateFromSchema(tool.inputSchema) ?? {}, null, 2),
  )
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async () => {
    let parsed: unknown
    try {
      parsed = args.trim() ? JSON.parse(args) : {}
    } catch {
      setOutput({ ok: false, text: '参数不是合法的 JSON' })
      return
    }
    setRunning(true)
    setOutput(null)
    const result = await execute(tool, parsed)
    setOutput(
      result.ok
        ? { ok: true, text: result.result ?? '（执行成功，没有返回值）' }
        : { ok: false, text: result.error ?? '执行失败' },
    )
    setRunning(false)
  }

  return (
    <li className='overflow-hidden rounded-xl border border-black/10 bg-white text-xs'>
      <button
        type='button'
        aria-expanded={expanded}
        onClick={onToggle}
        className='flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.02]'
      >
        <span className='flex min-w-0 flex-1 flex-col gap-1'>
          <span className='flex flex-wrap items-center gap-1.5'>
            <span className='truncate font-mono text-[12.5px] font-medium text-neutral-900'>
              {tool.name}
            </span>
            {tool.readOnly ? (
              <Badge tone='safe' icon={ShieldCheck}>
                只读
              </Badge>
            ) : (
              <Badge tone='warn' icon={ShieldAlert}>
                可能修改数据
              </Badge>
            )}
            {tool.frameId !== 0 && (
              <Badge tone='plain' icon={Frame}>
                iframe
              </Badge>
            )}
          </span>
          {tool.description && (
            <span className={`leading-relaxed text-neutral-500 ${expanded ? '' : 'line-clamp-2'}`}>
              {tool.description}
            </span>
          )}
        </span>
        <ChevronDown
          className={`mt-0.5 size-4 shrink-0 text-neutral-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className='flex flex-col gap-2 border-t border-black/5 bg-black/[0.015] px-3 py-2.5'>
          <label
            className='text-[11px] font-medium text-neutral-600'
            htmlFor={`args-${tool.frameId}-${tool.name}`}
          >
            参数（JSON，已按 Schema 生成模板）
          </label>
          <textarea
            id={`args-${tool.frameId}-${tool.name}`}
            value={args}
            rows={Math.min(10, Math.max(3, args.split('\n').length))}
            spellCheck={false}
            onChange={(event) => setArgs(event.target.value)}
            className='popup-field w-full resize-y rounded-lg border px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-neutral-800 outline-none'
          />
          <div className='flex items-center justify-between gap-2'>
            <span className='text-[11px] text-neutral-500'>
              {tool.readOnly ? '只读工具，不会修改网页数据' : '执行会直接作用在网页上'}
            </span>
            <Button
              variant='primary'
              onClick={() => void run()}
              loading={running}
              className='!px-3 !py-1 text-xs'
            >
              <Play className='size-3' aria-hidden />
              执行
            </Button>
          </div>
          {output && (
            <div className='flex flex-col gap-1'>
              <span
                className={`text-[11px] font-medium ${output.ok ? 'text-emerald-700' : 'text-rose-600'}`}
              >
                {output.ok ? '执行结果' : '执行失败'}
              </span>
              <pre
                className={`max-h-56 overflow-auto rounded-lg p-2 font-mono text-[11px] whitespace-pre-wrap break-all ${
                  output.ok ? 'bg-black/[0.04] text-neutral-700' : 'bg-rose-50 text-rose-700'
                }`}
              >
                {output.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
