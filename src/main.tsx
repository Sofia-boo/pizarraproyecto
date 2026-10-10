import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AnonymousGate from './AnonymousGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnonymousGate />
  </StrictMode>,
)
