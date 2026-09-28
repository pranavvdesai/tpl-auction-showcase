// Client-side copy of the auction rules. The database functions in
// supabase/migrations are the source of truth; keep both in sync.
import type { Settings } from './types'

export function bidIncrement(amount: number): number {
  if (amount < 1000) return 50
  if (amount < 3000) return 100
  return 200
}

export function nextBidAmount(basePrice: number, currentBid: number | null): number {
  return currentBid == null ? basePrice : currentBid + bidIncrement(currentBid)
}

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

export type BidCheck = { ok: true } | { ok: false; reason: string }

export function checkBid(args: {
  teamId: string
  teamName: string
  standing: Standing
  amount: number
  minimum: number
  leadingTeamId: string | null
  settings: Settings
}): BidCheck {
  const { teamId, teamName, standing, amount, minimum, leadingTeamId, settings } = args
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'Enter a whole number of points.' }
  if (amount < minimum) return { ok: false, reason: `Bid must be at least ${minimum} points.` }
  if (leadingTeamId === teamId) return { ok: false, reason: `${teamName} already holds the highest bid.` }
  if (standing.squad_count >= settings.max_squad) return { ok: false, reason: `${teamName} already has a full squad.` }
  if (amount > standing.max_bid) {
    return { ok: false, reason: `${teamName} can bid at most ${standing.max_bid} points.` }
  }
  return { ok: true }
}
