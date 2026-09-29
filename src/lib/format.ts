import type { Role } from './types'

const numberFormat = new Intl.NumberFormat('en-IN')

export function pts(value: number | null | undefined): string {
  return value == null ? '—' : numberFormat.format(value)
}

// Rulebook wording for the three auction groups.
const ROLE_LABELS: Record<Role, string> = {
  Batter: 'Batsman',
  Bowler: 'Bowler',
  'All-rounder': 'All-rounder',
  Wicketkeeper: 'Batsman',
}

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role
}
