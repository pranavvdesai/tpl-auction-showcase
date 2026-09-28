import { useEffect, useState } from 'react'
import { CategoryTag } from '../components/CategoryTag'
import { pts } from '../lib/format'
import type { AuctionData, Player, TeamStanding } from '../lib/types'
import { useAuction } from '../lib/useAuction'

type View = 'auto' | 'squads'

export default function Projection() {
  const { data, error, live } = useAuction('projection')
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).get('view') === 'squads' ? 'squads' : 'auto',
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen()
      if (e.key === 't' || e.key === 'T') setView((v) => (v === 'squads' ? 'auto' : 'squads'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="projection" onDoubleClick={toggleFullscreen}>
      <header className="proj-top">
        <img src="/sportscom-logo.jpeg" alt="" />
        <div className="proj-title">
          <span>TAPMI Premier League</span>
          <strong>{data?.settings.season_name ?? 'TPL'} Player Auction</strong>
        </div>
        <div className="proj-status">
          <span className="proj-dummy">Dummy data preview</span>
          <span className={`live-dot ${live ? 'on' : ''}`}>{live ? 'LIVE' : 'Connecting'}</span>
        </div>
      </header>

      <div className="proj-controls">
        <button onClick={() => setView(view === 'squads' ? 'auto' : 'squads')}>
          {view === 'squads' ? 'Show live lot (T)' : 'Show squads (T)'}
        </button>
        <button onClick={toggleFullscreen}>Fullscreen (F)</button>
      </div>

      {error && !data && <div className="proj-message">Waiting for auction data… ({error})</div>}
      {!data && !error && <div className="proj-message">Loading…</div>}
      {data && (
        <>
          <section className="proj-stage">
            {view === 'squads' ? <SquadsBoard data={data} /> : <Stage data={data} />}
          </section>
          <footer className="proj-teams">
            {data.teams.map((t) => (
              <TeamCard
                key={t.id}
                team={t}
                maxSquad={data.settings.max_squad}
                leading={data.state.status === 'live' && data.state.current_team_id === t.id}
              />
            ))}
          </footer>
        </>
      )}
    </main>
  )
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.()
}

function Stage({ data }: { data: AuctionData }) {
  const { state, teams } = data
  const player = data.players.find((p) => p.id === state.current_player_id)
  if (!player || state.status === 'idle') return <IdleBoard data={data} />

  const leader = teams.find((t) => t.id === state.current_team_id) ?? null
  const bids = data.bids.filter((b) => b.player_id === player.id).slice(0, 4)

  return (
    <div className="proj-lot">
      <div className="proj-player">
        <div className="proj-lotno">
          LOT #{player.lot_no} <CategoryTag category={player.category} />
        </div>
        <h1>{player.name}</h1>
        <div className="proj-role">{player.role}</div>
        <div className="proj-details">
          <span>{player.batch}</span>
          {player.batting_style && <span>{player.batting_style}</span>}
          {player.bowling_style && <span>{player.bowling_style}</span>}
        </div>
        {player.highlight && <p className="proj-highlight">{player.highlight}</p>}
        <div className="proj-base">
          Base price <strong>{pts(player.base_price)}</strong>
        </div>
      </div>

      <div className="proj-bid" style={{ ['--team' as string]: leader?.color ?? '#334155' }}>
        <div className="proj-bid-label">{state.current_bid == null ? 'Awaiting first bid' : 'Current bid'}</div>
        <div className="proj-bid-amount" key={state.current_bid ?? 0}>
          {pts(state.current_bid ?? player.base_price)}
          <span>pts</span>
        </div>
        <div className="proj-bid-team">{leader ? leader.name : '—'}</div>
        {bids.length > 0 && (
          <ul className="proj-bid-log">
            {bids.map((b) => {
              const team = teams.find((t) => t.id === b.team_id)
              return (
                <li key={b.id}>
                  <span className="team-dot" style={{ background: team?.color }} />
                  {team?.short_code}
                  <strong>{pts(b.amount)}</strong>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {state.status === 'sold' && leader && (
        <div className="proj-stamp sold" key={`sold-${state.updated_at}`} style={{ ['--team' as string]: leader.color }}>
          <div className="stamp-word">SOLD</div>
          <div className="stamp-detail">
            to {leader.name} for {pts(state.current_bid)} pts
          </div>
        </div>
      )}
      {state.status === 'unsold' && (
        <div className="proj-stamp unsold" key={`unsold-${state.updated_at}`}>
          <div className="stamp-word">UNSOLD</div>
        </div>
      )}
    </div>
  )
}

function IdleBoard({ data }: { data: AuctionData }) {
  const sold = data.players.filter((p) => p.status === 'sold')
  const totalSpent = sold.reduce((s, p) => s + (p.sold_price ?? 0), 0)
  const top = [...sold].sort((a, b) => (b.sold_price ?? 0) - (a.sold_price ?? 0)).slice(0, 5)
  const remaining = data.players.filter((p) => p.status !== 'sold').length
  const teamsById = new Map(data.teams.map((t) => [t.id, t]))

  return (
    <div className="proj-idle">
      <h1>{sold.length === 0 ? 'The auction is about to begin' : 'Next player coming up'}</h1>
      <div className="proj-stats">
        <Stat label="Players sold" value={String(sold.length)} />
        <Stat label="Points spent" value={pts(totalSpent)} />
        <Stat label="Highest buy" value={top[0] ? pts(top[0].sold_price) : '—'} />
        <Stat label="Players remaining" value={String(remaining)} />
      </div>
      {top.length > 0 && (
        <div className="proj-top-buys">
          <h2>Top buys</h2>
          <ol>
            {top.map((p) => {
              const team = p.team_id ? teamsById.get(p.team_id) : undefined
              return (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span style={{ color: team?.color }}>{team?.name}</span>
                  <strong>{pts(p.sold_price)}</strong>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="proj-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function SquadsBoard({ data }: { data: AuctionData }) {
  return (
    <div className="proj-squads">
      {data.teams.map((t) => {
        const squad: Player[] = data.players
          .filter((p) => p.team_id === t.id)
          .sort((a, b) => (b.sold_price ?? 0) - (a.sold_price ?? 0))
        return (
          <div key={t.id} className="proj-squad" style={{ ['--team' as string]: t.color }}>
            <h3>{t.name}</h3>
            <ul>
              {squad.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <strong>{pts(p.sold_price)}</strong>
                </li>
              ))}
              {squad.length === 0 && <li className="muted">No players yet</li>}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function TeamCard({ team, maxSquad, leading }: { team: TeamStanding; maxSquad: number; leading: boolean }) {
  return (
    <div className={`proj-team ${leading ? 'leading' : ''}`} style={{ ['--team' as string]: team.color }}>
      <div className="proj-team-name">{team.name}</div>
      <div className="proj-team-purse">{pts(team.remaining)}</div>
      <div className="proj-team-meta">
        {team.squad_count}/{maxSquad} players · max {pts(team.max_bid)}
      </div>
    </div>
  )
}
