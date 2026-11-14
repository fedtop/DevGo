import '@/assets/global.css'

import React from 'react'
import ReactDOM from 'react-dom/client'

import LocaleRoot from '@/ui/LocaleRoot'
import { initI18n } from '@/utils/i18n'

import { initDocumentTheme } from '@/utils/theme'

import App from './App'

void Promise.all([initDocumentTheme(), initI18n()])
  .catch(() => undefined)
  .finally(() =>
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <LocaleRoot>
          <App />
        </LocaleRoot>
      </React.StrictMode>,
    ),
  )
