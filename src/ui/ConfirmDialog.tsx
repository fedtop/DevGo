import { useEffect, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

import Button from '@/ui/Button'
import { t } from '@/utils/i18n'

interface ConfirmDialogProps {
  title: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onClose: () => void
  children: ReactNode
}

/** 通用确认框：开启有副作用的设置前，讲清楚会做什么、影响什么 */
export default function ConfirmDialog({
  title,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-[var(--ui-scrim)] p-4 backdrop-blur-sm'
      onClick={onClose}
    >
      <div
        role='alertdialog'
        aria-modal='true'
        aria-label={title}
        className='w-full max-w-[460px] rounded-2xl border border-black/10 bg-white p-5 shadow-[var(--ui-shadow-popover)]'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='flex items-start gap-3'>
          <span className='flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600'>
            <TriangleAlert className='size-[18px]' strokeWidth={1.8} aria-hidden />
          </span>
          <div className='min-w-0 flex-1'>
            <h3 className='text-[15px] font-semibold text-neutral-900'>{title}</h3>
            <div className='mt-2 flex flex-col gap-3 text-[13px] leading-relaxed text-neutral-600'>
              {children}
            </div>
          </div>
        </div>
        <div className='mt-5 flex justify-end gap-2'>
          <Button onClick={onClose}>{cancelLabel ?? t('common.confirmDialog.cancel')}</Button>
          <Button variant='primary' onClick={onConfirm}>
            {confirmLabel ?? t('common.confirmDialog.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
