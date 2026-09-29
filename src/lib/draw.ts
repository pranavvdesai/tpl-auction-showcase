import type { AuctionState, Lot, Player, Role } from './types'

type DrawState = Pick<AuctionState, 'status' | 'current_player_id' | 'updated_at' | 'phase'>

/** Changes only when a new player is drawn from a lot; the unsold round has no draw animation. */
export function drawKey(state: DrawState | null | undefined): string | null {
  if (!state || state.phase !== 'lots' || state.status !== 'live' || !state.current_player_id) return null
  return `${state.current_player_id}:${state.updated_at}`
}

/** Changes only when the operator draws the lot order. */
export function lotOrderKey(state: Pick<AuctionState, 'phase' | 'lot_order' | 'lot_order_drawn_at'> | null | undefined): string | null {
  if (!state || state.phase === 'setup' || !state.lot_order?.length || !state.lot_order_drawn_at) return null
  return state.lot_order_drawn_at
}

/** `previous` is undefined until the first state has been seen, so nothing replays when the page opens or refreshes. */
export function shouldDraw(previous: string | null | undefined, next: string | null): boolean {
  return previous !== undefined && next !== null && next !== previous
}

const LOT_LABELS: Record<Role, string> = {
  Batter: 'Batsmen',
  Wicketkeeper: 'Batsmen',
  Bowler: 'Bowlers',
  'All-rounder': 'All-rounders',
}

export function lotLabel(role: Role): string {
  return LOT_LABELS[role] ?? role
}

export function inLot(role: Role, lot: Lot): boolean {
  return role === lot || (lot === 'Batter' && role === 'Wicketkeeper')
}

export function currentLot(state: Pick<AuctionState, 'lot_order' | 'current_lot'>): Lot | null {
  return (state.current_lot && state.lot_order?.[state.current_lot - 1]) || null
}

type PoolPlayer = Pick<Player, 'role' | 'status' | 'reauctioned'>

/** Players still waiting in each lot, and unsold players still due in the unsold round. */
export function remaining(players: PoolPlayer[], lot: Lot | null) {
  return {
    inLot: lot ? players.filter((p) => p.status === 'available' && inLot(p.role, lot)).length : 0,
    lots: players.filter((p) => p.status === 'available').length,
    unsold: players.filter((p) => p.status === 'unsold' && !p.reauctioned).length,
  }
}

/** Long names go on two lines, split at the space that best balances the line lengths. */
export function splitName(name: string): string[] {
  const words = name.trim().split(/\s+/)
  const clean = words.join(' ')
  if (clean.length <= 14 || words.length < 2) return [clean]
  const longest = (i: number) => Math.max(words.slice(0, i).join(' ').length, words.slice(i).join(' ').length)
  let best = 1
  for (let i = 2; i < words.length; i++) if (longest(i) < longest(best)) best = i
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}
