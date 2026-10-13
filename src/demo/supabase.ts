// DEMO BUILD: this file replaces the real Supabase client with an in-browser stand-in
// (src/demo/db.ts) that exposes the same calls the app makes. Every page and component is
// unchanged from production; only the data source differs.
import type { Session } from '@supabase/supabase-js'
import { callRpc, DbError, onAuth, onChange, readTable, savePhoto, signedIn, signIn, signOut, DEMO_EMAIL } from './db'

export const supabaseConfigured = true

type Result<T> = { data: T; error: null } | { data: null; error: { message: string } }

const delay = <T,>(fn: () => T): Promise<Result<T>> =>
  new Promise((resolve) => {
    window.setTimeout(() => {
      try {
        resolve({ data: fn(), error: null })
      } catch (e) {
        resolve({ data: null, error: { message: e instanceof DbError || e instanceof Error ? e.message : String(e) } })
      }
    }, 30)
  })

class Query<T = unknown> implements PromiseLike<Result<T>> {
  private sortKey: string | null = null
  private one = false

  constructor(private table: string) {}

  select(_columns?: string) {
    return this
  }

  order(column: string) {
    this.sortKey = column
    return this
  }

  single() {
    this.one = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this as unknown as Query<any>
  }

  then<A = Result<T>, B = never>(
    onFulfilled?: ((value: Result<T>) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return delay(() => {
      let rows = readTable(this.table) as Array<Record<string, unknown>>
      if (this.sortKey) {
        const key = this.sortKey
        rows = [...rows].sort((a, b) => Number(a[key] ?? 0) - Number(b[key] ?? 0))
      }
      return (this.one ? rows[0] ?? null : rows) as T
    }).then(onFulfilled, onRejected)
  }
}

const demoSession = (): Session =>
  ({
    access_token: 'demo',
    refresh_token: 'demo',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'demo-operator', email: DEMO_EMAIL, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
  }) as unknown as Session

type StatusCallback = (status: string) => void

class Channel {
  private handlers: Array<() => void> = []
  private off: (() => void) | null = null

  on(_type: string, _filter: unknown, handler: () => void) {
    this.handlers.push(handler)
    return this
  }

  subscribe(callback?: StatusCallback) {
    this.off = onChange(() => this.handlers.forEach((h) => h()))
    window.setTimeout(() => callback?.('SUBSCRIBED'), 50)
    return this
  }

  unsubscribe() {
    this.off?.()
    this.off = null
  }
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

export const supabase = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => new Query<any[]>(table),
  rpc: (name: string, args?: Record<string, unknown>) => delay(() => callRpc(name, args) as never),
  channel: (_name: string) => new Channel(),
  removeChannel: async (channel: Channel) => {
    channel.unsubscribe()
    return 'ok'
  },
  auth: {
    getSession: async () => ({ data: { session: signedIn() ? demoSession() : null }, error: null }),
    onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
      const off = onAuth((event) => callback(event, event === 'SIGNED_IN' ? demoSession() : null))
      return { data: { subscription: { unsubscribe: off } } }
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) =>
      signIn(email, password)
        ? { data: { session: demoSession(), user: demoSession().user }, error: null }
        : { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } },
    signOut: async () => {
      signOut()
      return { error: null }
    },
  },
  storage: {
    from: (_bucket: string) => ({
      upload: async (path: string, file: Blob, _options?: Record<string, unknown>) => {
        try {
          savePhoto(path, await readAsDataUrl(file))
          return { data: { path }, error: null }
        } catch (e) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
        }
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `demo-photo:${path}` } }),
    }),
  },
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}
