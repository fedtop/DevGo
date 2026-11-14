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
import { t } from '@/utils/i18n'
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
      <EmptyState icon={FlaskConical} title={t('assistant.webmcp.unsupported.title')}>
        {t('assistant.webmcp.unsupported.description')}
      </EmptyState>
    )
  }
  if (status === 'unavailable') {
    return (
      <EmptyState
        icon={CircleAlert}
        title={t('assistant.webmcp.unavailable.title')}
        onRefresh={onRefresh}
      >
        {t('assistant.webmcp.unavailable.description')}
      </EmptyState>
    )
  }
  if (status === 'loading') {
    return (
      <EmptyState icon={Loader2} spin title={t('assistant.webmcp.loading.title')}>
        {t('assistant.webmcp.loading.description')}
      </EmptyState>
    )
  }
  if (tools.length === 0) {
    return (
      <EmptyState icon={PlugZap} title={t('assistant.webmcp.empty.title')} onRefresh={onRefresh}>
        {t('assistant.webmcp.empty.description')}
      </EmptyState>
    )
  }

  return (
    <div className='min-h-0 flex-1 overflow-y-auto px-3 py-3'>
      <div className='mb-2 flex items-center justify-between gap-2 px-0.5'>
        <p className='text-xs text-neutral-500'>
          {t('assistant.webmcp.summary', { count: tools.length })}
        </p>
        <IconButton
          label={t('assistant.webmcp.refresh')}
          onClick={onRefresh}
          className='!size-7 [&_svg]:!size-3.5'
        >
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
          {t('assistant.webmcp.refresh')}
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
      setOutput({ ok: false, text: t('assistant.webmcp.invalidJson') })
      return
    }
    setRunning(true)
    setOutput(null)
    const result = await execute(tool, parsed)
    setOutput(
      result.ok
        ? { ok: true, text: result.result ?? t('assistant.webmcp.noResult') }
        : { ok: false, text: result.error ?? t('assistant.webmcp.failed') },
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
                {t('assistant.webmcp.readOnly')}
              </Badge>
            ) : (
              <Badge tone='warn' icon={ShieldAlert}>
                {t('assistant.webmcp.mayModify')}
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
            {t('assistant.webmcp.argsLabel')}
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
              {tool.readOnly ? t('assistant.webmcp.readOnlyHint') : t('assistant.webmcp.writeHint')}
            </span>
            <Button
              variant='primary'
              onClick={() => void run()}
              loading={running}
              className='!px-3 !py-1 text-xs'
            >
              <Play className='size-3' aria-hidden />
              {t('assistant.webmcp.execute')}
            </Button>
          </div>
          {output && (
            <div className='flex flex-col gap-1'>
              <span
                className={`text-[11px] font-medium ${output.ok ? 'text-emerald-700' : 'text-rose-600'}`}
              >
                {output.ok ? t('assistant.webmcp.result') : t('assistant.webmcp.failed')}
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
