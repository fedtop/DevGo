import Select from '@/ui/Select'
import { t } from '@/utils/i18n'
import type { NetworkProxyProfile, NetworkProxyScheme } from '@/utils/settings'

import { SCHEME_OPTIONS } from './model'

const INPUT_CLASS =
  'min-w-0 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-700 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500'

interface ProxyServerFieldsProps {
  profile: NetworkProxyProfile
  onChange: (update: (profile: NetworkProxyProfile) => NetworkProxyProfile) => void
  /** 是否在各输入框上方显示字段名 */
  labeled?: boolean
}

/** 代理服务器：协议 + 主机 + 端口 */
export default function ProxyServerFields({ profile, onChange, labeled }: ProxyServerFieldsProps) {
  const fields = [
    {
      key: 'scheme',
      label: t('network.server.scheme'),
      control: (
        <Select
          value={profile.scheme}
          options={SCHEME_OPTIONS}
          onChange={(value) =>
            onChange((item) => ({ ...item, scheme: value as NetworkProxyScheme }))
          }
        />
      ),
    },
    {
      key: 'host',
      label: t('network.server.host'),
      control: (
        <input
          value={profile.host}
          placeholder='127.0.0.1'
          onChange={(event) => onChange((item) => ({ ...item, host: event.target.value }))}
          className={INPUT_CLASS}
        />
      ),
    },
    {
      key: 'port',
      label: t('network.server.port'),
      control: (
        <input
          value={profile.port || ''}
          inputMode='numeric'
          placeholder='7890'
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '')
            onChange((item) => ({ ...item, port: digits ? Number(digits) : 0 }))
          }}
          className={INPUT_CLASS}
        />
      ),
    },
  ]

  return (
    <div className='grid grid-cols-[92px_1fr_72px] gap-2'>
      {fields.map(({ key, label, control }) =>
        labeled ? (
          <label key={key} className='flex min-w-0 flex-col gap-1'>
            <span className='text-[11px] font-medium text-neutral-500'>{label}</span>
            {control}
          </label>
        ) : (
          <div key={key} className='contents'>
            {control}
          </div>
        ),
      )}
    </div>
  )
}

export { INPUT_CLASS }
