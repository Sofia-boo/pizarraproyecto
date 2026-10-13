import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AnonymousGate from './AnonymousGate'
import AppUpdate from './components/AppUpdate'
import './pwa'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnonymousGate />
    <AppUpdate />
  </StrictMode>,
)
