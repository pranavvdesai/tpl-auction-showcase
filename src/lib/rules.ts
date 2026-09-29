// Client-side copy of the auction rules. The database functions in
// supabase/migrations are the source of truth; keep both in sync.
import type { Settings } from './types'

// Bidding ladder from the rulebook: steps of 10 up to 100, then steps of 20.
export const LADDER_BREAK = 100
export const LOW_STEP = 10
export const HIGH_STEP = 20

export function isValidBid(amount: number): boolean {
  if (!Number.isInteger(amount) || amount < LOW_STEP) return false
  return amount <= LADDER_BREAK ? amount % LOW_STEP === 0 : (amount - LADDER_BREAK) % HIGH_STEP === 0
}

export function floorToBid(amount: number): number {
  if (amount < LOW_STEP) return 0
  if (amount <= LADDER_BREAK) return Math.floor(amount / LOW_STEP) * LOW_STEP
  return LADDER_BREAK + Math.floor((amount - LADDER_BREAK) / HIGH_STEP) * HIGH_STEP
}

export function nextBid(amount: number): number {
  const valid = floorToBid(amount)
  return valid < LADDER_BREAK ? valid + LOW_STEP : valid + HIGH_STEP
}

export function previousBid(amount: number): number {
  const valid = floorToBid(amount)
  if (valid < amount) return valid
  return valid <= LADDER_BREAK ? valid - LOW_STEP : valid - HIGH_STEP
}

export interface Standing {
  spent: number
  remaining: number
  squad_count: number
  max_bid: number
  needed: number
}

export function computeStanding(
  purseTotal: number,
  soldPrices: number[],
  settings: Settings,
  retainedOwner = false,
): Standing {
  const retention = retainedOwner ? settings.retention_cost : 0
  const spent = retention + soldPrices.reduce((sum, p) => sum + p, 0)
  const remaining = purseTotal - spent
  const squad_count = soldPrices.length + (retainedOwner ? 1 : 0)
  const reserve = Math.max(settings.min_squad - squad_count - 1, 0) * settings.min_base
  const max_bid = squad_count >= settings.max_squad ? 0 : floorToBid(Math.max(remaining - reserve, 0))
  return { spent, remaining, squad_count, max_bid, needed: Math.max(settings.min_squad - squad_count, 0) }
}

export type SaleCheck = { ok: true } | { ok: false; reason: string }

export function checkSale(args: {
  teamName: string
  standing: Pick<Standing, 'squad_count' | 'max_bid'>
  amount: number
  basePrice: number
  settings: Settings
}): SaleCheck {
  const { teamName, standing, amount, basePrice, settings } = args
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'Enter a whole number of points.' }
  if (amount < basePrice) return { ok: false, reason: `Final amount must be at least the base price of ${basePrice} points.` }
  if (!isValidBid(amount)) {
    return {
      ok: false,
      reason: `${amount} is not a valid bid: bids rise in 10s up to 100, then in 20s. Nearest: ${floorToBid(amount)} or ${nextBid(amount)}.`,
    }
  }
  if (standing.squad_count >= settings.max_squad) return { ok: false, reason: `${teamName} already has a full squad.` }
  if (amount > standing.max_bid) {
    return { ok: false, reason: `${teamName} can spend at most ${standing.max_bid} points.` }
  }
  return { ok: true }
}
