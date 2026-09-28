import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type OperatorSession =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'not-operator'; session: Session }
  | { status: 'operator'; session: Session }

export function useOperatorSession(): OperatorSession {
  const [state, setState] = useState<OperatorSession>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    const evaluate = async (session: Session | null) => {
      if (!session) {
        if (!cancelled) setState({ status: 'signed-out' })
        return
      }
      const { data, error } = await supabase.rpc('is_operator')
      if (cancelled) return
      setState(!error && data === true ? { status: 'operator', session } : { status: 'not-operator', session })
    }

    void supabase.auth.getSession().then(({ data }) => evaluate(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void evaluate(session)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}
