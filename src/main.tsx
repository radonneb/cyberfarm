import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './App.css'
import App from './App.tsx'
import { I18nProvider } from './i18n'
import { AppStoreProvider } from './store/appStore'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AppStoreProvider>
          <App />
        </AppStoreProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)
