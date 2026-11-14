import { useEffect, useState } from 'react'

import Switch from '@/ui/Switch'
import { t } from '@/utils/i18n'
import { sendRuntimeMessage } from '@/utils/messaging'
import { enableCorsBypass } from '@/utils/settings'

/** 解除 CORS 限制：为网页 XHR/fetch 响应补充跨域头（DNR 动态规则） */
export default function CorsSection() {
  const [corsOn, setCorsOn] = useState(false)
  const [corsBusy, setCorsBusy] = useState(false)
  const [corsStatus, setCorsStatus] = useState('')

  useEffect(() => {
    let active = true
    enableCorsBypass.getValue().then((enabled) => {
      if (!active) return
      setCorsOn(enabled)
      if (enabled) {
        sendRuntimeMessage({ type: 'sync-cors-bypass' }).catch((error) => {
          console.warn('[DevGo] sync CORS bypass failed:', error)
        })
      }
    })
    return () => {
      active = false
    }
  }, [])

  const toggleCors = async (checked: boolean) => {
    if (corsBusy) return
    setCorsBusy(true)
    setCorsStatus('')

    try {
      if (checked) {
        await enableCorsBypass.setValue(true)
        const active = await sendRuntimeMessage({ type: 'sync-cors-bypass' })
        setCorsOn(active)
        setCorsStatus(active ? t('network.cors.enabled') : t('network.cors.notActive'))
        return
      }

      await enableCorsBypass.setValue(false)
      await sendRuntimeMessage({ type: 'sync-cors-bypass' })
      setCorsOn(false)
      setCorsStatus(t('network.cors.disabled'))
    } catch (error) {
      console.warn('[DevGo] toggle CORS bypass failed:', error)
      await enableCorsBypass.setValue(false)
      await sendRuntimeMessage({ type: 'sync-cors-bypass' }).catch(() => false)
      setCorsOn(false)
      setCorsStatus(t('network.cors.failed'))
    } finally {
      setCorsBusy(false)
    }
  }

  return (
    <section className='rounded-lg border border-neutral-200 bg-white p-2.5'>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className='text-sm font-semibold text-neutral-800'>{t('network.cors.title')}</h2>
          <p className='text-xs text-neutral-500'>{t('network.cors.desc')}</p>
        </div>
        <Switch checked={corsOn} onChange={toggleCors} disabled={corsBusy} />
      </div>
      <p className='mt-2 text-[10px] leading-4 text-neutral-500'>{t('network.cors.note')}</p>
      {corsStatus && <p className='mt-1 text-[10px] leading-4 text-neutral-500'>{corsStatus}</p>}
    </section>
  )
}
