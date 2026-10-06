// The post-auction workbook: one sheet per team with every player's contact number,
// plus a summary and the players nobody bought.
import { battingLabel, bowlingLabel, pts, roleLabel } from './format'
import type { AuctionData, Player } from './types'
import { writeXlsx, type OutCell, type OutSheet } from './xlsxWrite'

const HEADER = ['No.', 'Player', 'Roll no', 'Class', 'Section', 'Role', 'Batting', 'Bowling', 'Contact number', 'Bought for (pts)']
const WIDTHS = [6, 28, 12, 10, 9, 15, 20, 22, 17, 16]

/** The letters after the intake year in the roll number: 26F243 → F, 26U37 → U. */
export function sectionFromRoll(rollNo: string): string | null {
  return rollNo.match(/^\d{2}([A-Z]+)/)?.[1] ?? null
}

const header = (labels: string[]): OutCell[] => labels.map((value) => ({ value, style: 'header' as const }))

function playerRow(n: number, p: Player, phone: string | undefined, price: number | null): OutCell[] {
  return [
    n,
    p.name,
    p.roll_no,
    p.batch,
    sectionFromRoll(p.roll_no),
    roleLabel(p.role),
    battingLabel(p.batting_style),
    bowlingLabel(p.bowling_style),
    phone ?? null,
    price,
  ]
}

export function buildTeamSheets(data: AuctionData, contacts: Map<string, string>): OutSheet[] {
  const { teams, players, settings } = data
  const season = settings.season_name

  const summary: OutSheet = {
    name: 'All teams',
    widths: [24, 12, 12, 12, 24],
    rows: [
      [{ value: `${season} auction — final squads`, style: 'title' }],
      [{ value: `Generated ${new Date().toLocaleString('en-IN')}`, style: 'subtitle' }],
      [],
      header(['Team', 'Players', 'Spent', 'Left', 'Retained owner']),
      ...teams.map((t) => [t.name, t.squad_count, t.spent, t.remaining, t.retained_owner]),
    ],
  }

  const teamSheets = teams.map((t): OutSheet => {
    const squad = players
      .filter((p) => p.status === 'sold' && p.team_id === t.id)
      .sort((a, b) => (a.sold_at ?? '').localeCompare(b.sold_at ?? ''))
    const rows: OutCell[][] = [
      [{ value: t.name, style: 'title' }],
      [
        {
          value: `${season} squad · ${t.squad_count} players · spent ${pts(t.spent)} of ${pts(t.purse_total)} · ${pts(t.remaining)} left`,
          style: 'subtitle',
        },
      ],
      [],
      header(HEADER),
    ]
    let n = 0
    if (t.retained_owner) {
      rows.push([++n, t.retained_owner, null, null, null, 'Retained owner', null, null, null, settings.retention_cost])
    }
    for (const p of squad) rows.push(playerRow(++n, p, contacts.get(p.roll_no), p.sold_price))
    rows.push([
      { value: null, style: 'total' },
      { value: 'Total', style: 'total' },
      ...Array.from({ length: 7 }, () => ({ value: null, style: 'total' as const })),
      { value: t.spent, style: 'total' },
    ])
    return { name: t.name, rows, widths: WIDTHS }
  })

  const leftOver = players.filter((p) => p.status !== 'sold').sort((a, b) => a.name.localeCompare(b.name))
  const unsold: OutSheet = {
    name: 'Unsold',
    widths: WIDTHS,
    rows: [
      [{ value: 'Players not bought', style: 'title' }],
      [{ value: `${leftOver.length} players`, style: 'subtitle' }],
      [],
      header([...HEADER.slice(0, 9), 'Base price']),
      ...leftOver.map((p, i) => playerRow(i + 1, p, contacts.get(p.roll_no), p.base_price)),
    ],
  }

  return [summary, ...teamSheets, unsold]
}

export async function downloadTeamSheets(data: AuctionData, contacts: Map<string, string>) {
  const blob = await writeXlsx(buildTeamSheets(data, contacts))
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${data.settings.season_name.replace(/\s+/g, '-')}-team-sheets.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
