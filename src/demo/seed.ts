// Fictional teams and players for the public demo. None of these are real TPL participants.
import type { Role } from '../lib/types'

export const SEASON_NAME = 'TPL Demo Season'

export function seedTeams() {
  return [
    { name: 'Demo Strikers', short_code: 'DS', color: '#dc2626' },
    { name: 'Demo Titans', short_code: 'DT', color: '#2563eb' },
    { name: 'Demo Mavericks', short_code: 'DM', color: '#16a34a' },
    { name: 'Demo Chargers', short_code: 'DC', color: '#ca8a04' },
  ]
}

const FIRST = [
  'Aarav', 'Kabir', 'Vihaan', 'Reyansh', 'Arjun', 'Ishan', 'Dev', 'Rohan', 'Kunal', 'Neel',
  'Aditya', 'Varun', 'Siddharth', 'Rahul', 'Karan', 'Yash', 'Pranay', 'Tanmay', 'Harsh', 'Nikhil',
]
const LAST = ['Mehra', 'Bhatt', 'Kulkarni', 'Iyer', 'Sethi', 'Chawla', 'Nair', 'Joshi', 'Rao', 'Ghosh', 'Kapoor', 'Menon']

const BATTING = ['Right-hand bat', 'Left-hand bat']
const BOWLING: Record<Role, Array<string | null>> = {
  Batter: [null, null, 'Right-arm off-spin'],
  Wicketkeeper: [null],
  Bowler: ['Right-arm fast', 'Left-arm fast', 'Right-arm medium', 'Right-arm leg-spin', 'Left-arm orthodox'],
  'All-rounder': ['Right-arm medium', 'Right-arm off-spin', 'Left-arm orthodox', 'Right-arm fast'],
}

const ROLES: Role[] = [
  ...Array<Role>(15).fill('Batter'),
  ...Array<Role>(5).fill('Wicketkeeper'),
  ...Array<Role>(20).fill('Bowler'),
  ...Array<Role>(20).fill('All-rounder'),
]

export function seedPlayers() {
  return ROLES.map((role, i) => {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]}`
    const bowl = BOWLING[role]
    return {
      name,
      roll_no: `DEMO${String(i + 1).padStart(3, '0')}`,
      batch: i % 2 === 0 ? 'MBA 1' : 'MBA 2',
      role,
      batting_style: BATTING[(i * 3) % 2],
      bowling_style: bowl[i % bowl.length],
    }
  })
}
