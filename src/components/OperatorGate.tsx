import { useEffect, type ReactNode } from 'react'
import { displayUsername } from '../lib/operatorLogin'
import { supabase } from '../lib/supabase'
import { useOperatorSession } from '../lib/useOperatorSession'
import { navigate } from '../router'

export function OperatorGate({ children }: { children: (email: string) => ReactNode }) {
  const session = useOperatorSession()

  useEffect(() => {
    if (session.status === 'signed-out') {
      navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`, { replace: true })
    }
  }, [session.status])

  if (session.status === 'loading' || session.status === 'signed-out') {
    return <main className="center-page muted">Checking operator access…</main>
  }
  if (session.status === 'not-operator') {
    return (
      <main className="center-page">
        <div className="card narrow">
          <h1>No operator access</h1>
          <p>{displayUsername(session.session.user.email)} is signed in but is not registered as an auction operator.</p>
          <button className="btn" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </main>
    )
  }
  return <>{children(displayUsername(session.session.user.email))}</>
}
