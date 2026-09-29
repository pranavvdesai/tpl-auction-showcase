import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Brand, DummyBadge } from '../components/Brand'
import { CategoryTag } from '../components/CategoryTag'
import { OperatorGate } from '../components/OperatorGate'
import { PlayerPhoto } from '../components/PlayerPhoto'
import { pts } from '../lib/format'
import { checkSale } from '../lib/rules'
import { errorMessage, supabase } from '../lib/supabase'
import type { AuctionData, Player, TeamStanding } from '../lib/types'
import { useAuction } from '../lib/useAuction'
import { Link } from '../router'

type PoolFilter = 'open' | 'available' | 'unsold' | 'sold' | 'all'
type Toast = { kind: 'ok' | 'error'; text: string }
type RpcResult = PromiseLike<{ error: unknown }>
type Group = 'All' | 'Batter' | 'Bowler' | 'All-rounder' | 'WK'

const GROUPS: Array<{ id: Group; label: string }> = [
  { id: 'All', label: 'All roles' },
  { id: 'Batter', label: 'Batters' },
  { id: 'Bowler', label: 'Bowlers' },
  { id: 'All-rounder', label: 'All-rounders' },
  { id: 'WK', label: 'Wicketkeepers' },
]

const groupLabel = (g: Group) => (GROUPS.find((x) => x.id === g)?.label ?? '').toLowerCase()

const inGroup = (p: Player, g: Group) =>
  g === 'All' || (g === 'WK' ? p.is_wicketkeeper || p.role === 'Wicketkeeper' : p.role === g)

export default function Operator() {
  return <OperatorGate>{(email) => <OperatorDesk email={email} />}</OperatorGate>
}

function OperatorDesk({ email }: { email: string }) {
  const { data, error, live, reload } = useAuction('operator-desk')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 2500)
    return () => window.clearTimeout(t)
  }, [toast])

  const run = async (successText: string, action: () => RpcResult) => {
    setBusy(true)
    try {
      const { error: rpcError } = await action()
      setToast(rpcError ? { kind: 'error', text: errorMessage(rpcError) } : { kind: 'ok', text: successText })
    } catch (e) {
      setToast({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
      await reload()
    }
  }

  return (
    <main className="operator">
      <header className="topbar">
        <Brand subtitle="Operator desk" />
        <div className="topbar-actions">
          <DummyBadge />
          <span className={`live-dot ${live ? 'on' : ''}`}>{live ? 'Live sync' : 'Connecting…'}</span>
          <Link className="btn ghost" to="/import">
            Import players
          </Link>
          <a className="btn ghost" href="/projection" target="_blank" rel="noreferrer">
            Open projection ↗
          </a>
          <span className="muted small">{email}</span>
          <button className="btn ghost" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      {error && <div className="toast error">Could not load auction data: {error}</div>}

      {!data ? (
        <div className="center-page muted">Loading auction…</div>
      ) : (
        <div className="operator-grid">
          <PlayerPool data={data} busy={busy} run={run} />
          <div className="operator-center">
            <LivePanel data={data} busy={busy} run={run} />
            <ResultsPanel data={data} busy={busy} run={run} />
          </div>
          <TeamsPanel data={data} busy={busy} run={run} />
        </div>
      )}
    </main>
  )
}

interface PanelProps {
  data: AuctionData
  busy: boolean
  run: (successText: string, action: () => RpcResult) => Promise<void>
}

function PlayerPool({ data, busy, run }: PanelProps) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<Group>('All')
  const [filter, setFilter] = useState<PoolFilter>('open')
  const lotLive = data.state.status === 'live'

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.players.filter((p) => {
      if (!inGroup(p, group)) return false
      if (filter === 'open' && p.status === 'sold') return false
      if (filter !== 'open' && filter !== 'all' && p.status !== filter) return false
      if (q && !`${p.name} ${p.roll_no} ${p.role} ${p.lot_no}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.players, query, group, filter])

  const groupPlayers = data.players.filter((p) => inGroup(p, group))
  const nextUp =
    groupPlayers.find((p) => p.status === 'available') ?? groupPlayers.find((p) => p.status === 'unsold') ?? null

  const counts = {
    available: data.players.filter((p) => p.status === 'available').length,
    sold: data.players.filter((p) => p.status === 'sold').length,
    unsold: data.players.filter((p) => p.status === 'unsold').length,
  }

  return (
    <section className="panel pool">
      <div className="panel-head">
        <h2>Player pool</h2>
        <span className="muted small">
          {counts.available} available · {counts.sold} sold · {counts.unsold} unsold
        </span>
      </div>

      <button
        className="btn primary block"
        disabled={busy || lotLive || !nextUp}
        onClick={() => nextUp && void run(`Lot ${nextUp.lot_no}: ${nextUp.name} is live`, () => supabase.rpc('start_lot', { p_player_id: nextUp.id }))}
      >
        {nextUp ? `Start next: #${nextUp.lot_no} ${nextUp.name}` : 'No players left in this group'}
      </button>
      {group !== 'All' && <p className="muted small">“Start next” picks from {groupLabel(group)} only.</p>}
      {data.players.length === 0 && (
        <p className="muted small">
          The pool is empty. <Link to="/import">Import the registration sheet</Link> to add players.
        </p>
      )}

      <input
        className="search"
        placeholder="Search name, roll no, role or lot #"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="chips">
        {GROUPS.map((g) => (
          <button key={g.id} className={`chip ${group === g.id ? 'active' : ''}`} onClick={() => setGroup(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      <select value={filter} onChange={(e) => setFilter(e.target.value as PoolFilter)}>
        <option value="open">Not yet sold</option>
        <option value="available">Available</option>
        <option value="unsold">Unsold</option>
        <option value="sold">Sold</option>
        <option value="all">All players</option>
      </select>

      <ul className="pool-list">
        {visible.map((p) => (
          <li key={p.id} className={`pool-item status-${p.status} ${p.id === data.state.current_player_id ? 'current' : ''}`}>
            <div className="pool-main">
              <span className="lot">#{p.lot_no}</span>
              <PlayerPhoto name={p.name} src={p.photo_url} className="avatar-sm" />
              <div>
                <div className="pool-name">{p.name}</div>
                <div className="muted small">
                  {p.role}
                  {p.is_wicketkeeper && p.role !== 'Wicketkeeper' ? ' · WK' : ''}
                  {p.category && (
                    <>
                      {' · '}
                      <CategoryTag category={p.category} />
                    </>
                  )}{' '}
                  · base {pts(p.base_price)}
                </div>
              </div>
            </div>
            {p.status === 'sold' ? (
              <span className="small sold-note">{pts(p.sold_price)}</span>
            ) : (
              <button
                className="btn small"
                disabled={busy || lotLive}
                onClick={() => void run(`Lot ${p.lot_no}: ${p.name} is live`, () => supabase.rpc('start_lot', { p_player_id: p.id }))}
              >
                {p.status === 'unsold' ? 'Re-auction' : 'Start'}
              </button>
            )}
          </li>
        ))}
        {visible.length === 0 && <li className="muted small empty">No players match these filters.</li>}
      </ul>
    </section>
  )
}

function LivePanel({ data, busy, run }: PanelProps) {
  const { state, settings, teams } = data
  const player = data.players.find((p) => p.id === state.current_player_id) ?? null
  const soldTo = teams.find((t) => t.id === state.current_team_id) ?? null
  const [teamId, setTeamId] = useState('')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    setTeamId('')
    setAmount('')
  }, [state.current_player_id])

  if (!player) {
    return (
      <section className="panel live empty-live">
        <h2>No player on the floor</h2>
        <p className="muted">Use “Start next” or pick a player from the pool to put them on the projector.</p>
      </section>
    )
  }

  const isLive = state.status === 'live'
  const team = teams.find((t) => t.id === teamId)
  const value = Number(amount)
  const check = !team
    ? ({ ok: false, reason: 'Pick the winning team.' } as const)
    : amount.trim() === ''
      ? ({ ok: false, reason: 'Enter the final amount.' } as const)
      : checkSale({ teamName: team.name, standing: team, amount: value, basePrice: player.base_price, settings })

  const sell = (e: FormEvent) => {
    e.preventDefault()
    if (!team || !check.ok) return
    void run(`${player.name} sold to ${team.name} for ${pts(value)}`, () =>
      supabase.rpc('sell_player', { p_team_id: team.id, p_amount: value }),
    )
  }

  return (
    <section className={`panel live lot-${state.status}`}>
      <div className="live-head">
        <PlayerPhoto name={player.name} src={player.photo_url} className="avatar-live" />
        <div className="live-info">
          <div className="muted small">
            Lot #{player.lot_no} · {player.roll_no}
            {player.batch ? ` · ${player.batch}` : ''}
          </div>
          <h2 className="live-name">{player.name}</h2>
          <div className="live-meta">
            <CategoryTag category={player.category} /> <span>{player.role}</span>
            {player.is_wicketkeeper && player.role !== 'Wicketkeeper' && <span>Wicketkeeper</span>}
            {player.batting_style && <span>{player.batting_style}</span>}
            {player.bowling_style && <span>{player.bowling_style}</span>}
          </div>
          {player.highlight && <div className="muted small">{player.highlight}</div>}
        </div>
        <div className="live-bid">
          {state.status === 'sold' && soldTo ? (
            <>
              <div className="muted small">Sold for</div>
              <div className="live-amount">{pts(state.current_bid)}</div>
              <div className="live-leader" style={{ color: soldTo.color }}>
                {soldTo.name}
              </div>
            </>
          ) : (
            <>
              <div className="muted small">Base price</div>
              <div className="live-amount">{pts(player.base_price)}</div>
            </>
          )}
        </div>
      </div>

      {state.status === 'sold' && soldTo && (
        <div className="result-banner sold" style={{ borderColor: soldTo.color }}>
          SOLD to {soldTo.name} for {pts(state.current_bid)} points
        </div>
      )}
      {state.status === 'unsold' && <div className="result-banner unsold">UNSOLD — can be re-auctioned later</div>}

      {isLive && (
        <form className="sale-form" onSubmit={sell}>
          <div className="muted small bid-hint">
            Bidding is on the floor. When it closes, pick the winning team, enter the final amount and press SOLD.
          </div>
          <div className="bid-grid" role="radiogroup" aria-label="Winning team">
            {teams.map((t) => {
              const full = t.squad_count >= settings.max_squad
              const cannotAfford = t.max_bid < player.base_price
              const reason = full ? `${t.name} already has a full squad.` : cannotAfford ? `${t.name} cannot afford the base price.` : ''
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={t.id === teamId}
                  className={`bid-btn ${t.id === teamId ? 'selected' : ''}`}
                  style={{ ['--team' as string]: t.color }}
                  disabled={busy || full || cannotAfford}
                  title={reason || `Select ${t.name}`}
                  onClick={() => setTeamId(t.id)}
                >
                  <span className="bid-team">{t.short_code}</span>
                  <span className="bid-name">{t.name}</span>
                  <span className="bid-amount">{pts(t.remaining)} left</span>
                  <span className="bid-limit">
                    max {pts(t.max_bid)} · {t.squad_count}/{settings.max_squad}
                  </span>
                </button>
              )
            })}
          </div>

          <label className="amount-field">
            <span>Final amount (points)</span>
            <input
              type="number"
              inputMode="numeric"
              min={player.base_price}
              step={1}
              placeholder={`at least ${player.base_price}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {team && amount.trim() !== '' && !check.ok && <p className="form-error small">{check.reason}</p>}

          <div className="lot-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => void run(`${player.name} taken off the screen`, () => supabase.rpc('cancel_lot'))}
            >
              Take off screen
            </button>
            <button
              type="button"
              className="btn danger-outline"
              disabled={busy}
              onClick={() => void run(`${player.name} marked unsold`, () => supabase.rpc('mark_unsold'))}
            >
              Unsold
            </button>
            <button type="submit" className="btn sold" disabled={busy || !check.ok}>
              SOLD{team && check.ok ? ` to ${team.short_code} · ${pts(value)}` : ''}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function ResultsPanel({ data, busy, run }: PanelProps) {
  const teamsById = new Map(data.teams.map((t) => [t.id, t]))
  const recent = data.players
    .filter((p) => p.status === 'sold')
    .sort((a, b) => (b.sold_at ?? '').localeCompare(a.sold_at ?? ''))
    .slice(0, 12)

  const revert = (p: Player) => {
    if (!window.confirm(`Revert the sale of ${p.name}? The player returns to the pool and the team gets the points back.`)) return
    void run(`${p.name} returned to the pool`, () => supabase.rpc('revert_sale', { p_player_id: p.id }))
  }

  const reset = () => {
    const answer = window.prompt('This clears every sale for the demo. Type RESET to confirm.')
    if (answer !== 'RESET') return
    void run('Auction reset', () => supabase.rpc('reset_auction'))
  }

  return (
    <section className="panel results">
      <div className="panel-head">
        <h2>Recent sales</h2>
        <button className="btn small danger-outline" disabled={busy} onClick={reset}>
          Reset demo auction
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="muted small">No players sold yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Lot</th>
              <th>Player</th>
              <th>Team</th>
              <th className="num">Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recent.map((p) => {
              const team = p.team_id ? teamsById.get(p.team_id) : undefined
              return (
                <tr key={p.id}>
                  <td>#{p.lot_no}</td>
                  <td>
                    <span className="name-with-avatar">
                      <PlayerPhoto name={p.name} src={p.photo_url} className="avatar-xs" />
                      {p.name}
                    </span>
                  </td>
                  <td>
                    <span className="team-dot" style={{ background: team?.color }} /> {team?.short_code}
                  </td>
                  <td className="num">{pts(p.sold_price)}</td>
                  <td className="num">
                    <button className="btn small ghost" disabled={busy} onClick={() => revert(p)}>
                      Revert
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

function TeamsPanel({ data }: PanelProps) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="panel teams">
      <div className="panel-head">
        <h2>Team purses</h2>
        <span className="muted small">
          squad {data.settings.min_squad}–{data.settings.max_squad}
        </span>
      </div>
      <ul className="team-list">
        {data.teams.map((t) => (
          <TeamRow
            key={t.id}
            team={t}
            squad={data.players.filter((p) => p.team_id === t.id)}
            maxSquad={data.settings.max_squad}
            open={open === t.id}
            onToggle={() => setOpen(open === t.id ? null : t.id)}
          />
        ))}
      </ul>
    </section>
  )
}

function TeamRow(props: { team: TeamStanding; squad: Player[]; maxSquad: number; open: boolean; onToggle: () => void }) {
  const { team, squad, maxSquad, open, onToggle } = props
  const usedPct = Math.min(100, (team.spent / team.purse_total) * 100)
  return (
    <li className="team-row" style={{ ['--team' as string]: team.color }}>
      <button className="team-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="team-badge">{team.short_code}</span>
        <span className="team-row-name">
          {team.name}
          <span className="muted small">
            {team.squad_count}/{maxSquad} players · max bid {pts(team.max_bid)}
          </span>
        </span>
        <span className="team-row-purse">
          {pts(team.remaining)}
          <span className="muted small">left</span>
        </span>
      </button>
      <div className="purse-bar">
        <div style={{ width: `${usedPct}%` }} />
      </div>
      {open && (
        <ul className="squad">
          {team.captain && <li className="muted small">Captain (not auctioned): {team.captain}</li>}
          {squad.length === 0 && <li className="muted small">No players bought yet.</li>}
          {squad.map((p) => (
            <li key={p.id}>
              <span className="name-with-avatar">
                <PlayerPhoto name={p.name} src={p.photo_url} className="avatar-xs" />
                {p.name} <span className="muted small">{p.role}</span>
              </span>
              <strong>{pts(p.sold_price)}</strong>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}