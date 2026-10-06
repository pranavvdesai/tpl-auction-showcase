import { useMemo, useState } from 'react'
import { battingLabel, bowlingLabel, pts, roleLabel } from '../lib/format'
import type { AuctionData, Player } from '../lib/types'
import { PlayerPhoto } from './PlayerPhoto'

type RoleFilter = 'All' | 'Batsman' | 'Bowler' | 'All-rounder'
const ROLE_FILTERS: RoleFilter[] = ['All', 'Batsman', 'Bowler', 'All-rounder']

function csvCell(value: string | number | null | undefined): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function PoolTable({ data }: { data: AuctionData }) {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<RoleFilter>('All')
  const teamsById = useMemo(() => new Map(data.teams.map((t) => [t.id, t])), [data.teams])

  const players = useMemo(() => [...data.players].sort((a, b) => a.name.localeCompare(b.name)), [data.players])
  const q = query.trim().toLowerCase()
  const visible = players.filter(
    (p) =>
      (role === 'All' || roleLabel(p.role) === role) &&
      (!q || `${p.name} ${p.roll_no} ${p.batch ?? ''}`.toLowerCase().includes(q)),
  )

  const count = (r: RoleFilter) => (r === 'All' ? players.length : players.filter((p) => roleLabel(p.role) === r).length)
  const statusText = (p: Player) => {
    if (p.status === 'sold') return `Sold to ${p.team_id ? (teamsById.get(p.team_id)?.name ?? '') : ''} · ${pts(p.sold_price)}`
    return p.status === 'unsold' ? 'Unsold' : 'Available'
  }

  const download = () => {
    const header = ['Name', 'Roll no', 'Class', 'Role', 'Batting', 'Bowling', 'Base price', 'Player no.', 'Status', 'Team', 'Sold for']
    const rows = players.map((p) => [
      p.name,
      p.roll_no,
      p.batch,
      roleLabel(p.role),
      battingLabel(p.batting_style),
      bowlingLabel(p.bowling_style),
      p.base_price,
      p.draw_no,
      p.status,
      p.team_id ? teamsById.get(p.team_id)?.name : '',
      p.sold_price,
    ])
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'tpl-player-pool.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="panel preview">
      <div className="panel-head">
        <h2>Current player pool</h2>
        <span className="muted small">
          {players.length} players · {players.filter((p) => p.status === 'sold').length} sold ·{' '}
          {players.filter((p) => p.status === 'unsold').length} unsold
        </span>
        <button className="btn small" onClick={download} disabled={players.length === 0}>
          Download list (Excel CSV)
        </button>
      </div>

      <div className="pool-table-tools">
        <input className="search" placeholder="Search name, roll no or class" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips">
          {ROLE_FILTERS.map((r) => (
            <button key={r} className={`chip ${role === r ? 'active' : ''}`} onClick={() => setRole(r)}>
              {r === 'All' ? 'All' : `${r}s`} ({count(r)})
            </button>
          ))}
        </div>
      </div>

      <div className="preview-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Photo</th>
              <th>Name</th>
              <th>Roll no</th>
              <th>Role</th>
              <th>Batting</th>
              <th>Bowling</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => (
              <tr key={p.id}>
                <td className="muted">{i + 1}</td>
                <td>
                  <PlayerPhoto name={p.name} src={p.photo_url} className="avatar-sm" />
                </td>
                <td>{p.name}</td>
                <td>{p.roll_no}</td>
                <td>
                  {roleLabel(p.role)}
                  {p.batch && <span className="tag">{p.batch}</span>}
                </td>
                <td className="small">{battingLabel(p.batting_style) ?? '—'}</td>
                <td className="small">{bowlingLabel(p.bowling_style) ?? '—'}</td>
                <td>
                  <span className={`badge ${p.status === 'sold' ? 'ok' : p.status === 'unsold' ? 'warn' : ''}`}>{statusText(p)}</span>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  {players.length === 0 ? 'The pool is empty. Import the registration sheet above.' : 'No players match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
