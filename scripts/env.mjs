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
export const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || 'operator@tpl-demo.in'
export const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD || 'REDACTED'

export function nodeClient(key = SUPABASE_ANON_KEY) {
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: globalThis.WebSocket ?? WebSocket },
  })
}
