import { useEffect, useState, type FormEvent } from 'react'
import { Brand, DummyBadge } from '../components/Brand'
import { errorMessage, supabase } from '../lib/supabase'
import { useOperatorSession } from '../lib/useOperatorSession'
import { Link, navigate } from '../router'

export default function Login() {
  const session = useOperatorSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session.status === 'operator') navigate('/operator', { replace: true })
  }, [session.status])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) throw signInError
      const { data: isOperator, error: rpcError } = await supabase.rpc('is_operator')
      if (rpcError) throw rpcError
      if (!isOperator) {
        await supabase.auth.signOut()
        throw new Error('This account is not registered as an auction operator.')
      }
      navigate('/operator', { replace: true })
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
        <DummyBadge />
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
