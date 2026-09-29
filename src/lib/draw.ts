import type { AuctionState, Player, Role } from './types'

type DrawState = Pick<AuctionState, 'status' | 'current_player_id' | 'updated_at'>

/** Changes only when the operator puts a player on the floor (start_lot). */
export function drawKey(state: DrawState | null | undefined): string | null {
  if (!state || state.status !== 'live' || !state.current_player_id) return null
  return `${state.current_player_id}:${state.updated_at}`
}

/** `previous` is undefined until the first state has been seen, so a lot already live at page load is not replayed. */
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

export function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
}

/** Picks uniformly from available players; once none are left, from unsold players (final draft). */
export function pickRandomPlayer<T extends Pick<Player, 'status'>>(players: T[], random: () => number = secureRandom): T | null {
  const available = players.filter((p) => p.status === 'available')
  const pool = available.length > 0 ? available : players.filter((p) => p.status === 'unsold')
  if (pool.length === 0) return null
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}
