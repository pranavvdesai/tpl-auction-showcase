import { useEffect, useState, type FormEvent } from 'react'
import { Brand } from '../components/Brand'
import { loginEmail } from '../lib/operatorLogin'
import { errorMessage, supabase } from '../lib/supabase'
import { useOperatorSession } from '../lib/useOperatorSession'
import { Link, navigate } from '../router'

function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next') ?? ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/operator'
}

export default function Login() {
  const session = useOperatorSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [next] = useState(nextPath)

  useEffect(() => {
    if (session.status === 'operator') navigate(next, { replace: true })
  }, [session.status, next])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: loginEmail(username), password })
      if (signInError) {
        throw new Error(/invalid login credentials/i.test(signInError.message) ? 'Wrong username or password.' : signInError.message)
      }
      const { data: isOperator, error: rpcError } = await supabase.rpc('is_operator')
      if (rpcError) throw rpcError
      if (!isOperator) {
        await supabase.auth.signOut()
        throw new Error('This account is not registered as an auction operator.')
      }
      navigate(next, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center-page">
      <form className="card narrow login" onSubmit={submit}>
        <div className="login-head">
          <Brand subtitle="Operator sign-in" />
        </div>
        <label>
          Username
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small">
          The projection screen needs no sign-in: <Link to="/projection">/projection</Link>
        </p>
      </form>
    </main>
  )
}
