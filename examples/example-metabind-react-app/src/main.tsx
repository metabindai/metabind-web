import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Prebuilt, self-contained chat stylesheet shipped by the package — no Tailwind
// needed in this app. It includes a CSS reset scoped to where it's loaded,
// which is exactly what a full-page chat app wants.
import '@metabindai/agent-ui/agent-ui.css'
import App from './app.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
