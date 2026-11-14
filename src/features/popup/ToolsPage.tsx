import { type ReactNode, useEffect, useMemo, useState } from 'react'

import {
  getDirectMediaDownloadBlockReason,
  getMediaDeliveryType,
  getUrlExtension,
  isDirectDownloadableMediaUrl,
  normalizeMime,
  type MediaDeliveryType,
} from '@/utils/media'
import { sendRuntimeMessage, type MediaResource, type MediaResourceKind } from '@/utils/messaging'
import Button from '@/ui/Button'
import { t, type MessageKey } from '@/utils/i18n'

type ResourceFilter = 'all' | MediaResourceKind

const FILTERS: Array<{ value: ResourceFilter; labelKey: MessageKey }> = [
  { value: 'all', labelKey: 'popup.tools.filter.all' },
  { value: 'image', labelKey: 'popup.tools.filter.image' },
  { value: 'video', labelKey: 'popup.tools.filter.video' },
]

const KIND_LABEL_KEYS: Record<MediaResourceKind, MessageKey> = {
  image: 'popup.tools.kind.image',
  video: 'popup.tools.kind.video',
}

const SOURCE_LABEL_KEYS: Record<MediaResource['source'], MessageKey> = {
  network: 'popup.tools.source.network',
  dom: 'popup.tools.source.dom',
  'network+dom': 'popup.tools.source.networkDom',
}
const DELIVERY_LABEL_KEYS: Partial<Record<MediaDeliveryType, MessageKey>> = {
  'stream-manifest': 'popup.tools.delivery.streamManifest',
  'stream-segment': 'popup.tools.delivery.streamSegment',
  'twitter-audio-track': 'popup.tools.delivery.twitterAudioTrack',
  'twitter-video-track': 'popup.tools.delivery.twitterVideoTrack',
}
const VIDEO_PREVIEW_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v'])

function formatBytes(value?: number): string {
  if (!value) return ''

  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function getPageLabel(tab: chrome.tabs.Tab | null): string {
  if (!tab?.url) return t('popup.tools.currentTab')

  try {
    return new URL(tab.url).hostname
  } catch {
    return tab.title || t('popup.tools.currentTab')
  }
}

function getResourceMeta(resource: MediaResource): string[] {
  const deliveryKey = DELIVERY_LABEL_KEYS[getMediaDeliveryType(resource.url, resource.mime)]

  return [
    deliveryKey && t(deliveryKey),
    resource.extension?.toUpperCase(),
    resource.mime,
    resource.width && resource.height ? `${resource.width}x${resource.height}` : '',
    formatBytes(resource.size),
    t(SOURCE_LABEL_KEYS[resource.source]),
  ].filter(Boolean) as string[]
}

function DownloadIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true' className='h-3.5 w-3.5 fill-none stroke-current'>
      <path d='M12 3v11' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
      <path d='m7 10 5 5 5-5' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
      <path d='M5 20h14' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true' className='h-3.5 w-3.5 fill-none stroke-current'>
      <path
        d='M8 8h10v10H8zM6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true' className='h-3.5 w-3.5 fill-none stroke-current'>
      <path d='M14 4h6v6' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
      <path d='m10 14 10-10' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
      <path
        d='M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true' className='h-3.5 w-3.5 fill-current'>
      <path d='M8 5.5v13l11-6.5z' />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true' className='h-3.5 w-3.5 fill-current'>
      <path d='M7 7h10v10H7z' />
    </svg>
  )
}

function canPreviewVideo(resource: MediaResource): boolean {
  if (resource.kind !== 'video') return false
  if (getMediaDeliveryType(resource.url, resource.mime) !== 'direct') return false

  const extension = (resource.extension || getUrlExtension(resource.url)).toLowerCase()
  const mime = normalizeMime(resource.mime)

  return VIDEO_PREVIEW_EXTENSIONS.has(extension) || ['video/mp4', 'video/webm'].includes(mime)
}

function ResourceFallbackIcon({ kind }: { kind: MediaResourceKind }) {
  return kind === 'video' ? (
    <PlayIcon />
  ) : (
    <span className='h-5 w-6 rounded border border-neutral-300 bg-white shadow-inner' />
  )
}

interface IconButtonProps {
  title: string
  disabled?: boolean
  active?: boolean
  children: ReactNode
  onClick: () => void
}

function IconButton({
  title,
  disabled = false,
  active = false,
  children,
  onClick,
}: IconButtonProps) {
  return (
    <button
      type='button'
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-accent-300 bg-accent-50 text-accent-700'
          : 'border-neutral-200 bg-white text-neutral-600 hover:border-accent-400 hover:text-accent-600'
      }`}
    >
      {children}
    </button>
  )
}

function ResourceThumbnail({
  resource,
  previewing,
  onTogglePreview,
}: {
  resource: MediaResource
  previewing: boolean
  onTogglePreview: (resource: MediaResource) => void
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const imageUrl = resource.thumbnailUrl || (resource.kind === 'image' ? resource.url : '')
  const showImage = Boolean(imageUrl && !imageFailed)
  const showVideo = !showImage && !videoFailed && canPreviewVideo(resource)
  const showPlay = resource.kind === 'video' && (showImage || showVideo)
  const previewable = canPreviewVideo(resource)

  const content = (
    <>
      {showImage && (
        <img
          src={imageUrl}
          alt=''
          loading='lazy'
          className='h-full w-full object-cover'
          onError={() => setImageFailed(true)}
        />
      )}

      {showVideo && (
        <video
          src={resource.url}
          muted
          playsInline
          preload='metadata'
          className='h-full w-full object-cover'
          onError={() => setVideoFailed(true)}
        />
      )}

      {!showImage && !showVideo && <ResourceFallbackIcon kind={resource.kind} />}

      {showPlay && (
        <span className='absolute inset-0 flex items-center justify-center bg-black/10'>
          <span className='flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white'>
            {previewing ? <StopIcon /> : <PlayIcon />}
          </span>
        </span>
      )}
    </>
  )

  if (!previewable) {
    return (
      <div className='relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-100 text-neutral-500'>
        {content}
      </div>
    )
  }

  return (
    <button
      type='button'
      title={previewing ? t('popup.tools.collapsePreview') : t('popup.tools.previewVideo')}
      aria-label={previewing ? t('popup.tools.collapsePreview') : t('popup.tools.previewVideo')}
      onClick={() => onTogglePreview(resource)}
      className='relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-100 text-neutral-500 outline-none transition-shadow hover:ring-2 hover:ring-accent-200'
    >
      {content}
    </button>
  )
}

interface ResourceItemProps {
  resource: MediaResource
  downloading: boolean
  previewing: boolean
  onCopy: (resource: MediaResource) => void
  onDownload: (resource: MediaResource) => void
  onOpen: (resource: MediaResource) => void
  onTogglePreview: (resource: MediaResource) => void
}

function ResourceItem({
  resource,
  downloading,
  previewing,
  onCopy,
  onDownload,
  onOpen,
  onTogglePreview,
}: ResourceItemProps) {
  const meta = getResourceMeta(resource)
  const previewable = canPreviewVideo(resource)
  const downloadBlockReason = getDirectMediaDownloadBlockReason(resource.url, resource.mime)
  let previewTitle = t('popup.tools.previewUnsupported')

  if (previewing) {
    previewTitle = t('popup.tools.collapsePreview')
  } else if (previewable) {
    previewTitle = t('popup.tools.previewVideo')
  }

  return (
    <div className='rounded-lg border border-neutral-200 bg-white p-2.5'>
      <div className='flex gap-2'>
        <ResourceThumbnail
          resource={resource}
          previewing={previewing}
          onTogglePreview={onTogglePreview}
        />

        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-1.5'>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                resource.kind === 'image'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-accent-50 text-accent-700'
              }`}
            >
              {t(KIND_LABEL_KEYS[resource.kind])}
            </span>
            <span
              className='truncate text-xs font-medium text-neutral-800'
              title={resource.fileName}
            >
              {resource.fileName}
            </span>
          </div>

          <div className='mt-1 truncate text-[11px] text-neutral-500' title={resource.url}>
            {getHostname(resource.url)}
          </div>

          {meta.length > 0 && (
            <div className='mt-1 flex flex-wrap gap-1'>
              {meta.map((item) => (
                <span
                  key={item}
                  className='max-w-[150px] truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500'
                  title={item}
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className='grid shrink-0 grid-cols-2 gap-1'>
          {resource.kind === 'video' ? (
            <IconButton
              title={previewTitle}
              active={previewing}
              disabled={!previewable}
              onClick={() => onTogglePreview(resource)}
            >
              {previewing ? <StopIcon /> : <PlayIcon />}
            </IconButton>
          ) : (
            <span className='h-7 w-7' aria-hidden='true' />
          )}
          <IconButton
            title={downloadBlockReason || t('popup.tools.download')}
            disabled={downloading || Boolean(downloadBlockReason)}
            onClick={() => onDownload(resource)}
          >
            <DownloadIcon />
          </IconButton>
          <IconButton title={t('popup.tools.copyLink')} onClick={() => onCopy(resource)}>
            <CopyIcon />
          </IconButton>
          <IconButton title={t('popup.tools.openLink')} onClick={() => onOpen(resource)}>
            <ExternalLinkIcon />
          </IconButton>
        </div>
      </div>

      {previewing && previewable && (
        <div className='mt-2 overflow-hidden rounded-md bg-black'>
          <video
            src={resource.url}
            poster={resource.thumbnailUrl}
            controls
            playsInline
            preload='metadata'
            className='aspect-video max-h-56 w-full bg-black object-contain'
          />
        </div>
      )}
    </div>
  )
}

export default function ToolsPage() {
  const [resources, setResources] = useState<MediaResource[]>([])
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null)
  const [filter, setFilter] = useState<ResourceFilter>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [statusError, setStatusError] = useState(false)
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({})
  const [previewingId, setPreviewingId] = useState('')

  const counts = useMemo(
    () => ({
      all: resources.length,
      image: resources.filter((resource) => resource.kind === 'image').length,
      video: resources.filter((resource) => resource.kind === 'video').length,
    }),
    [resources],
  )

  const filteredResources = useMemo(() => {
    const keyword = query.trim().toLowerCase()

    return resources.filter((resource) => {
      if (filter !== 'all' && resource.kind !== filter) return false
      if (!keyword) return true

      return [
        resource.fileName,
        resource.url,
        resource.mime,
        resource.extension,
        getHostname(resource.url),
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(keyword))
    })
  }, [filter, query, resources])

  const loadResources = async (includeDom = true) => {
    if (loading) return
    setLoading(true)
    setStatus('')
    setStatusError(false)

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
      setCurrentTab(tab || null)

      if (tab?.id == null) {
        setStatusError(true)
        setStatus(t('popup.tools.readTabFailed'))
        setResources([])
        return
      }

      const result = await sendRuntimeMessage({
        type: 'get-media-resources',
        tabId: tab.id,
        includeDom,
      })

      setResources(result.resources)
      setPreviewingId((current) =>
        result.resources.some((resource) => resource.id === current) ? current : '',
      )
      if (result.error) {
        setStatusError(true)
        setStatus(result.error)
      }
    } catch (error) {
      setStatusError(true)
      setStatus(error instanceof Error ? error.message : String(error))
      setResources([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadResources().catch((error) => {
      console.warn('[DevGo] load media resources failed:', error)
    })
  }, [])

  const clearResources = async () => {
    if (loading || currentTab?.id == null) return
    setLoading(true)
    setStatus('')
    setStatusError(false)

    try {
      const result = await sendRuntimeMessage({
        type: 'clear-media-resources',
        tabId: currentTab.id,
      })
      setResources([])
      setPreviewingId('')
      setStatus(t('popup.tools.cleared', { count: result.removed }))
    } catch (error) {
      setStatusError(true)
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const copyResourceUrl = async (resource: MediaResource) => {
    try {
      await navigator.clipboard.writeText(resource.url)
      setStatus(t('popup.tools.linkCopied'))
      setStatusError(false)
    } catch {
      setStatusError(true)
      setStatus(t('popup.tools.copyFailed'))
    }
  }

  const openResource = (resource: MediaResource) => {
    browser.tabs.create({ url: resource.url })
  }

  const togglePreview = (resource: MediaResource) => {
    if (!canPreviewVideo(resource)) return
    setPreviewingId((current) => (current === resource.id ? '' : resource.id))
  }

  const downloadResource = async (resource: MediaResource, saveAs = true): Promise<boolean> => {
    const blockReason = getDirectMediaDownloadBlockReason(resource.url, resource.mime)
    if (blockReason) {
      setStatusError(true)
      setStatus(blockReason)
      return false
    }

    setDownloadingIds((current) => ({ ...current, [resource.id]: true }))

    try {
      const result = await sendRuntimeMessage({
        type: 'download-media-resource',
        url: resource.url,
        fileName: resource.fileName,
        mime: resource.mime,
        saveAs,
      })

      if (!result.ok) {
        setStatusError(true)
        setStatus(result.error || t('popup.tools.downloadFailed'))
        return false
      }

      setStatusError(false)
      setStatus(t('popup.tools.downloadCreated'))
      return true
    } catch (error) {
      setStatusError(true)
      setStatus(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setDownloadingIds((current) => ({ ...current, [resource.id]: false }))
    }
  }

  const downloadAll = async () => {
    if (bulkBusy) return

    const downloadables = filteredResources.filter((resource) =>
      isDirectDownloadableMediaUrl(resource.url, resource.mime),
    )
    const skippedCount = filteredResources.length - downloadables.length

    if (downloadables.length === 0) {
      setStatusError(true)
      setStatus(
        skippedCount > 0 ? t('popup.tools.noDirectDownloadable') : t('popup.tools.noDownloadable'),
      )
      return
    }

    setBulkBusy(true)
    // 批量下载不弹出逐个保存窗口，避免大量系统对话框。
    const results = await Promise.all(
      downloadables.map((resource) => downloadResource(resource, false)),
    )
    const okCount = results.filter(Boolean).length

    setBulkBusy(false)
    setStatusError(okCount === 0)
    setStatus(
      skippedCount > 0
        ? t('popup.tools.bulkResultSkipped', {
            ok: okCount,
            total: downloadables.length,
            skipped: skippedCount,
          })
        : t('popup.tools.bulkResult', { ok: okCount, total: downloadables.length }),
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <section className='rounded-lg border border-neutral-200 bg-white p-3'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='text-sm font-semibold text-neutral-800'>{t('popup.tools.title')}</div>
            <div className='mt-0.5 truncate text-xs text-neutral-500'>
              {getPageLabel(currentTab)}
            </div>
          </div>
          <div className='flex shrink-0 gap-1.5'>
            <Button
              onClick={() => loadResources()}
              loading={loading}
              className='!px-2 !py-1 text-xs'
            >
              {t('popup.tools.refresh')}
            </Button>
            <Button
              onClick={clearResources}
              disabled={loading || resources.length === 0}
              className='!px-2 !py-1 text-xs'
            >
              {t('popup.tools.clear')}
            </Button>
          </div>
        </div>

        <div className='mt-3 grid grid-cols-3 gap-2'>
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type='button'
              onClick={() => setFilter(item.value)}
              className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
                filter === item.value
                  ? 'border-accent-300 bg-accent-50 text-accent-700'
                  : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300'
              }`}
            >
              <span className='block text-[10px]'>{t(item.labelKey)}</span>
              <span className='mt-0.5 block text-sm font-semibold'>{counts[item.value]}</span>
            </button>
          ))}
        </div>

        <div className='mt-3 flex gap-2'>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('popup.tools.searchPlaceholder')}
            className='min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-700 outline-none transition-colors placeholder:text-neutral-400 focus:border-accent-400 focus:bg-white'
          />
          <Button
            onClick={downloadAll}
            loading={bulkBusy}
            disabled={filteredResources.length === 0}
            className='!px-2.5 !py-1.5 text-xs'
          >
            {t('popup.tools.downloadAll')}
          </Button>
        </div>
      </section>

      {status && (
        <div
          className={`rounded-lg px-3 py-2 text-xs ${
            statusError ? 'bg-rose-50 text-rose-600' : 'bg-neutral-100 text-neutral-500'
          }`}
        >
          {status}
        </div>
      )}

      <div className='flex items-center justify-between text-xs text-neutral-500'>
        <span>{t('popup.tools.count', { count: filteredResources.length })}</span>
        {loading && <span>{t('popup.tools.scanning')}</span>}
      </div>

      <div className='flex max-h-[390px] flex-col gap-2 overflow-y-auto pr-1'>
        {!loading && filteredResources.length === 0 ? (
          <div className='rounded-lg border border-dashed border-neutral-200 bg-white px-4 py-10 text-center text-xs text-neutral-500'>
            {t('popup.tools.empty')}
          </div>
        ) : (
          filteredResources.map((resource) => (
            <ResourceItem
              key={resource.id}
              resource={resource}
              downloading={Boolean(downloadingIds[resource.id])}
              previewing={previewingId === resource.id}
              onCopy={copyResourceUrl}
              onDownload={downloadResource}
              onOpen={openResource}
              onTogglePreview={togglePreview}
            />
          ))
        )}
      </div>
    </div>
  )
}
