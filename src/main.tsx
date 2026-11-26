import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './app/App'
import { installGlobalErrorHandlers, rootErrorHandlers } from './observability/errorHandlers'

// Imports are evaluated before this line, so a failure while loading a module (for example an
// invalid VITE_API_BASE_URL in config/env.ts) happens before any handler exists. It still
// appears in the browser console; it is a deployment error, not a runtime one.
installGlobalErrorHandlers()

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement, rootErrorHandlers).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
