// Client-side copy of the auction rules. The database functions in
// supabase/migrations are the source of truth; keep both in sync.
import type { Settings } from './types'

export interface Standing {
  spent: number
  remaining: number
  squad_count: number
  max_bid: number
}

export function computeStanding(purseTotal: number, soldPrices: number[], settings: Settings): Standing {
  const spent = soldPrices.reduce((sum, p) => sum + p, 0)
  const remaining = purseTotal - spent
  const squad_count = soldPrices.length
  const reserve = Math.max(settings.min_squad - squad_count - 1, 0) * settings.min_base
  const max_bid = squad_count >= settings.max_squad ? 0 : Math.max(remaining - reserve, 0)
  return { spent, remaining, squad_count, max_bid }
}

export type SaleCheck = { ok: true } | { ok: false; reason: string }

export function checkSale(args: {
  teamName: string
  standing: Standing
  amount: number
  basePrice: number
  settings: Settings
}): SaleCheck {
  const { teamName, standing, amount, basePrice, settings } = args
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'Enter a whole number of points.' }
  if (amount < basePrice) return { ok: false, reason: `Final amount must be at least the base price of ${basePrice} points.` }
  if (standing.squad_count >= settings.max_squad) return { ok: false, reason: `${teamName} already has a full squad.` }
  if (amount > standing.max_bid) {
    return { ok: false, reason: `${teamName} can spend at most ${standing.max_bid} points.` }
  }
  return { ok: true }
}
