import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

config({ path: '.env.local' })
config()

export function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}. Add it to .env.local (see .env.example).`)
    process.exit(1)
  }
  return value
}

export const SUPABASE_URL = requireEnv('VITE_SUPABASE_URL')
export const SUPABASE_ANON_KEY = requireEnv('VITE_SUPABASE_ANON_KEY')
// Same mapping as src/lib/operatorLogin.ts: a plain username signs in as <username>@tpl-auction.invalid.
const operatorUsername = requireEnv('OPERATOR_USERNAME').trim().toLowerCase()
export const OPERATOR_EMAIL = operatorUsername.includes('@') ? operatorUsername : `${operatorUsername}@tpl-auction.invalid`
export const OPERATOR_PASSWORD = requireEnv('OPERATOR_PASSWORD')

export function nodeClient(key = SUPABASE_ANON_KEY) {
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: globalThis.WebSocket ?? WebSocket },
  })
}
