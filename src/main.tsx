import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const DemoBanner = import.meta.env.VITE_TPL_DEMO === '1' ? lazy(() => import('./demo/DemoBanner').then((m) => ({ default: m.DemoBanner }))) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {DemoBanner && (
      <Suspense fallback={null}>
        <DemoBanner />
      </Suspense>
    )}
  </StrictMode>,
)
