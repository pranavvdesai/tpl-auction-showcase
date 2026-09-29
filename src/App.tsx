import { supabaseConfigured } from './lib/supabase'
import { Link, usePathname } from './router'
import { lazy, Suspense } from 'react'
import Home from './pages/Home'
import Login from './pages/Login'
import Operator from './pages/Operator'
import Projection from './pages/Projection'

const ImportPage = lazy(() => import('./pages/Import'))

export default function App() {
  const path = usePathname()

  if (!supabaseConfigured) {
    return (
      <main className="center-page">
        <div className="card narrow">
          <h1>Configuration missing</h1>
          <p>VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set for this build.</p>
        </div>
      </main>
    )
  }

  switch (path) {
    case '/':
      return <Home />
    case '/login':
      return <Login />
    case '/operator':
      return <Operator />
    case '/import':
      return (
        <Suspense fallback={<main className="center-page muted">Loading importer…</main>}>
          <ImportPage />
        </Suspense>
      )
    case '/projection':
      return <Projection />
    default:
      return (
        <main className="center-page">
          <div className="card narrow">
            <h1>Page not found</h1>
            <p>
              <Link to="/">Back to the dashboard home</Link>
            </p>
          </div>
        </main>
      )
  }
}
