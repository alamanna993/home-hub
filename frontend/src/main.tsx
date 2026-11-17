import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/atkinson-hyperlegible-next/400.css'
import '@fontsource/atkinson-hyperlegible-next/500.css'
import '@fontsource/atkinson-hyperlegible-next/600.css'
import '@fontsource/atkinson-hyperlegible-next/700.css'
import '@fontsource/atkinson-hyperlegible-next/400-italic.css'
// Recipe reader only — @font-face files download on first use
import '@fontsource/source-serif-4/400.css'
import '@fontsource/source-serif-4/600.css'
import '@fontsource/source-serif-4/400-italic.css'
import App from './App'
import { ThemeProvider } from './hooks/useTheme'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)
