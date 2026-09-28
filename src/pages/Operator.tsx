import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Brand, DummyBadge } from '../components/Brand'
import { CategoryTag } from '../components/CategoryTag'
import { pts } from '../lib/format'
import { checkBid, nextBidAmount } from '../lib/rules'
import { errorMessage, supabase } from '../lib/supabase'
import type { AuctionData, Category, Player, TeamStanding } from '../lib/types'
import { useAuction } from '../lib/useAuction'
import { useOperatorSession } from '../lib/useOperatorSession'
import { navigate } from '../router'

type PoolFilter = 'open' | 'available' | 'unsold' | 'sold' | 'all'
type Toast = { kind: 'ok' | 'error'; text: string }
type RpcResult = PromiseLike<{ error: unknown }>

const CATEGORIES: Array<Category | 'All'> = ['All', 'Marquee', 'A', 'B', 'C']

export default function Operator() {
  const session = useOperatorSession()

  useEffect(() => {
    if (session.status === 'signed-out') navigate('/login', { replace: true })
  }, [session.status])

  if (session.status === 'loading' || session.status === 'signed-out') {
    return <main className="center-page muted">Checking operator access…</main>
  }
  if (session.status === 'not-operator') {
    return (
      <main className="center-page">
        <div className="card narrow">
          <h1>No operator access</h1>
          <p>{session.session.user.email} is signed in but is not registered as an auction operator.</p>
          <button className="btn" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </main>
    )
  }
  return <OperatorDesk email={session.session.user.email ?? 'operator'} />
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
  const [category, setCategory] = useState<Category | 'All'>('All')
  const [filter, setFilter] = useState<PoolFilter>('open')
  const lotLive = data.state.status === 'live'

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.players.filter((p) => {
      if (category !== 'All' && p.category !== category) return false
      if (filter === 'open' && p.status === 'sold') return false
      if (filter !== 'open' && filter !== 'all' && p.status !== filter) return false
      if (q && !`${p.name} ${p.roll_no} ${p.role} ${p.lot_no}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.players, query, category, filter])

  const nextUp =
    data.players.find((p) => p.status === 'available') ?? data.players.find((p) => p.status === 'unsold') ?? null

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
        {nextUp ? `Start next: #${nextUp.lot_no} ${nextUp.name}` : 'No players left'}
      </button>

      <input
        className="search"
        placeholder="Search name, roll no, role or lot #"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="chips">
        {CATEGORIES.map((c) => (
          <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
            {c === 'All' ? 'All sets' : c === 'Marquee' ? 'Marquee' : `Set ${c}`}
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
              <div>
                <div className="pool-name">{p.name}</div>
                <div className="muted small">
                  {p.role} · <CategoryTag category={p.category} /> · base {pts(p.base_price)}
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
  const leader = teams.find((t) => t.id === state.current_team_id) ?? null
  const lotBids = player ? data.bids.filter((b) => b.player_id === player.id) : []
  const minimum = player ? nextBidAmount(player.base_price, state.current_bid) : 0
  const [customTeam, setCustomTeam] = useState('')
  const [customAmount, setCustomAmount] = useState('')

  useEffect(() => {
    setCustomAmount('')
  }, [state.current_player_id, state.current_bid])

  if (!player) {
    return (
      <section className="panel live empty-live">
        <h2>No player on the floor</h2>
        <p className="muted">Use “Start next” or pick a player from the pool to open bidding.</p>
      </section>
    )
  }

  const isLive = state.status === 'live'
  const customValue = Number(customAmount || minimum)
  const customTeamRow = teams.find((t) => t.id === customTeam)
  const customCheck = customTeamRow
    ? checkBid({
        teamId: customTeamRow.id,
        teamName: customTeamRow.name,
        standing: customTeamRow,
        amount: customValue,
        minimum,
        leadingTeamId: state.current_team_id,
        settings,
      })
    : ({ ok: false, reason: 'Choose a team.' } as const)

  const submitCustom = (e: FormEvent) => {
    e.preventDefault()
    if (!customTeamRow || !customCheck.ok) return
    void run(`${customTeamRow.short_code} bids ${pts(customValue)}`, () =>
      supabase.rpc('place_bid', { p_team_id: customTeamRow.id, p_amount: customValue }),
    )
  }

  return (
    <section className={`panel live lot-${state.status}`}>
      <div className="live-head">
        <div>
          <div className="muted small">
            Lot #{player.lot_no} · {player.roll_no} · {player.batch}
          </div>
          <h2 className="live-name">{player.name}</h2>
          <div className="live-meta">
            <CategoryTag category={player.category} /> <span>{player.role}</span>
            {player.batting_style && <span>{player.batting_style}</span>}
            {player.bowling_style && <span>{player.bowling_style}</span>}
          </div>
          {player.highlight && <div className="muted small">{player.highlight}</div>}
        </div>
        <div className="live-bid">
          <div className="muted small">{state.current_bid == null ? 'Base price' : 'Current bid'}</div>
          <div className="live-amount">{pts(state.current_bid ?? player.base_price)}</div>
          <div className="live-leader" style={{ color: leader?.color }}>
            {leader ? leader.name : 'No bids yet'}
          </div>
        </div>
      </div>

      {state.status === 'sold' && leader && (
        <div className="result-banner sold" style={{ borderColor: leader.color }}>
          SOLD to {leader.name} for {pts(state.current_bid)} points
        </div>
      )}
      {state.status === 'unsold' && <div className="result-banner unsold">UNSOLD — can be re-auctioned later</div>}

      {isLive && (
        <>
          <div className="muted small bid-hint">
            Next valid bid: <strong>{pts(minimum)}</strong> points. Tap a team to record its bid.
          </div>
          <div className="bid-grid">
            {teams.map((t) => {
              const check = checkBid({
                teamId: t.id,
                teamName: t.name,
                standing: t,
                amount: minimum,
                minimum,
                leadingTeamId: state.current_team_id,
                settings,
              })
              return (
                <button
                  key={t.id}
                  className={`bid-btn ${t.id === state.current_team_id ? 'leading' : ''}`}
                  style={{ ['--team' as string]: t.color }}
                  disabled={busy || !check.ok}
                  title={check.ok ? `${t.name} bids ${minimum}` : check.reason}
                  onClick={() =>
                    void run(`${t.short_code} bids ${pts(minimum)}`, () =>
                      supabase.rpc('place_bid', { p_team_id: t.id, p_amount: minimum }),
                    )
                  }
                >
                  <span className="bid-team">{t.short_code}</span>
                  <span className="bid-name">{t.name}</span>
                  <span className="bid-amount">{t.id === state.current_team_id ? 'Leading' : `+ ${pts(minimum)}`}</span>
                  <span className="bid-limit">
                    max {pts(t.max_bid)} · {t.squad_count}/{settings.max_squad}
                  </span>
                </button>
              )
            })}
          </div>

          <form className="custom-bid" onSubmit={submitCustom}>
            <select value={customTeam} onChange={(e) => setCustomTeam(e.target.value)}>
              <option value="">Custom bid: choose team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (max {pts(t.max_bid)})
                </option>
              ))}
            </select>
            <input
              type="number"
              min={minimum}
              step={50}
              placeholder={String(minimum)}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
            />
            <button className="btn" type="submit" disabled={busy || !customCheck.ok}>
              Place bid
            </button>
            {customTeamRow && !customCheck.ok && <span className="form-error small">{customCheck.reason}</span>}
          </form>

          <div className="lot-actions">
            <button className="btn" disabled={busy || lotBids.length === 0} onClick={() => void run('Last bid undone', () => supabase.rpc('undo_bid'))}>
              Undo last bid
            </button>
            <button
              className="btn danger-outline"
              disabled={busy || lotBids.length > 0}
              onClick={() => void run(`${player.name} marked unsold`, () => supabase.rpc('mark_unsold'))}
            >
              Unsold
            </button>
            <button
              className="btn sold"
              disabled={busy || !leader}
              onClick={() => void run(`${player.name} sold to ${leader?.name}`, () => supabase.rpc('sell_lot'))}
            >
              SOLD{leader ? ` to ${leader.short_code} · ${pts(state.current_bid)}` : ''}
            </button>
          </div>
        </>
      )}

      {lotBids.length > 0 && (
        <div className="bid-log">
          <h3>Bids on this lot</h3>
          <ol>
            {lotBids.map((b) => {
              const team = teams.find((t) => t.id === b.team_id)
              return (
                <li key={b.id}>
                  <span className="team-dot" style={{ background: team?.color }} />
                  {team?.name ?? 'Unknown team'} <strong>{pts(b.amount)}</strong>
                  <span className="muted small"> {new Date(b.created_at).toLocaleTimeString()}</span>
                </li>
              )
            })}
          </ol>
        </div>
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
    const answer = window.prompt('This clears every bid and sale for the demo. Type RESET to confirm.')
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
                  <td>{p.name}</td>
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
              {p.name} <span className="muted small">{p.role}</span>
              <strong>{pts(p.sold_price)}</strong>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}