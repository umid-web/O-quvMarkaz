import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './admin/styles/admin.scss'
import App from './App.jsx'
import { initializeClientData } from './api/backend.js'
import LegacyCacheRecovery from './api/LegacyCacheRecovery.jsx'
import ErrorBoundary from './admin/components/ui/ErrorBoundary.jsx'

initializeClientData()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary><LegacyCacheRecovery><App /></LegacyCacheRecovery></ErrorBoundary>
  </StrictMode>,
)
