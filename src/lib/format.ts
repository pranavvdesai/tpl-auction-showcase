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

/** "Right-hand bat" → "Right-hand batsman" */
export function battingLabel(style: string | null): string | null {
  return style ? style.replace(/\bbat$/i, 'batsman') : null
}

/** The form only asks "pace" or a spin type; pace is shown as fast ("Right-arm fast"). */
export function bowlingLabel(style: string | null): string | null {
  return style ? style.replace(/(^|-arm )pace$/i, (_, arm: string) => `${arm}${arm ? 'fast' : 'Fast'}`) : null
}
