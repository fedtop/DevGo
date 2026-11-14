import '@/assets/global.css'

import React from 'react'
import ReactDOM from 'react-dom/client'

import LocaleRoot from '@/ui/LocaleRoot'
import { initI18n } from '@/utils/i18n'

import { migrateStorage } from '@/utils/settings'
import App from './App'

const render = () =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LocaleRoot>
        <App />
      </LocaleRoot>
    </React.StrictMode>,
  )

// 先完成存储迁移（旧版 sync 数据搬回本机）再渲染，避免读到空数据；迁移失败也不阻塞渲染。
Promise.all([migrateStorage().catch(() => undefined), initI18n().catch(() => undefined)]).finally(
  render,
)
