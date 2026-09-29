import { useEffect, useState } from 'react'
import { DrawReveal, LotOrderReveal, useReveals } from '../components/DrawReveal'
import { PlayerPhoto } from '../components/PlayerPhoto'
import { currentLot, lotLabel } from '../lib/draw'
import { pts, roleLabel } from '../lib/format'
import type { AuctionData, AuctionState, Player, TeamStanding } from '../lib/types'
import { useAuction } from '../lib/useAuction'

type View = 'auto' | 'squads'

export default function Projection() {
  const { data, error, live } = useAuction('projection')
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).get('view') === 'squads' ? 'squads' : 'auto',
  )
  const reveals = useReveals(data?.state)
  const { skip } = reveals
  const drawnPlayer = reveals.playerDraw ? data?.players.find((p) => p.id === data.state.current_player_id) : undefined
  const lotOrder = data?.state.lot_order

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen()
      if (e.key === 't' || e.key === 'T') setView((v) => (v === 'squads' ? 'auto' : 'squads'))
      if (e.key === ' ') {
        e.preventDefault()
        skip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [skip])

  return (
    <main className="projection" onDoubleClick={toggleFullscreen}>
      <header className="proj-top">
        <img src="/sportscom-logo.jpeg" alt="" />
        <div className="proj-title">
          <span>TAPMI Premier League</span>
          <strong>{data?.settings.season_name ?? 'TPL'} Player Auction</strong>
        </div>
        <div className="proj-status">
          {data && <span className="proj-phase">{phaseLabel(data.state)}</span>}
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
            {view === 'squads' ? (
              <SquadsBoard data={data} />
            ) : reveals.lotOrderDraw && lotOrder ? (
              <LotOrderReveal key={reveals.lotOrderDraw} order={lotOrder} />
            ) : reveals.playerDraw && drawnPlayer ? (
              <DrawReveal key={reveals.playerDraw} player={drawnPlayer} />
            ) : (
              <Stage data={data} />
            )}
          </section>
          <footer className="proj-teams">
            {data.teams.map((t) => (
              <TeamCard
                key={t.id}
                team={t}
                maxSquad={data.settings.max_squad}
                leading={data.state.status === 'sold' && data.state.current_team_id === t.id}
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

function phaseLabel(state: AuctionState): string {
  const lot = currentLot(state)
  switch (state.phase) {
    case 'setup':
      return 'Starting soon'
    case 'ready':
      return 'Lot order drawn'
    case 'lots':
      return lot ? `Lot ${state.current_lot} of ${state.lot_order?.length ?? 3} · ${lotLabel(lot)}` : 'Auction live'
    case 'unsold':
      return 'Unsold round'
    case 'ended':
      return 'Auction complete'
  }
}

function LotOrder({ state, compact = false }: { state: AuctionState; compact?: boolean }) {
  const order = state.lot_order ?? []
  const running = state.phase === 'lots'
  const finished = state.phase === 'unsold' || state.phase === 'ended'
  return (
    <div className={`lot-order-row ${compact ? 'compact' : ''}`}>
      {order.map((lot, i) => {
        const n = i + 1
        const cls = running && n === state.current_lot ? 'current' : finished || (running && n < (state.current_lot ?? 0)) ? 'done' : ''
        return (
          <div key={lot} className={`lot-order-card ${cls}`}>
            <span>LOT {n}</span>
            <strong>{lotLabel(lot).toUpperCase()}</strong>
          </div>
        )
      })}
    </div>
  )
}

function Stage({ data }: { data: AuctionData }) {
  const { state, teams } = data
  const player = data.players.find((p) => p.id === state.current_player_id)
  if (!player || state.status === 'idle') return <IdleBoard data={data} />

  const buyer = state.status === 'sold' ? (teams.find((t) => t.id === state.current_team_id) ?? null) : null

  return (
    <div className="proj-lot">
      <div className="proj-bid" style={{ ['--team' as string]: buyer?.color ?? '#b45309' }}>
        {buyer ? (
          <>
            <div className="proj-bid-label">Sold for</div>
            <div className="proj-bid-amount">
              {pts(state.current_bid)}
              <span>pts</span>
            </div>
            <div className="proj-bid-team">{buyer.name}</div>
          </>
        ) : (
          <>
            <div className="proj-bid-label">Base price</div>
            <div className="proj-bid-amount">
              {pts(player.base_price)}
              <span>pts</span>
            </div>
            <div className={`proj-bid-team ${state.status === 'live' ? 'bidding' : ''}`}>
              {state.status === 'live' ? 'Bidding in progress' : state.status === 'unsold' ? 'Unsold' : '—'}
            </div>
          </>
        )}
      </div>

      <div className="proj-center">
        <div className="proj-lotno">LOT #{player.lot_no}</div>
        <div className="proj-photo" style={{ ['--team' as string]: buyer?.color ?? '#b45309' }}>
          <PlayerPhoto name={player.name} src={player.photo_url} className="avatar-proj" eager />
        </div>
        <h1>{player.name}</h1>
        <div className="proj-role">
          {roleLabel(player.role)}
          {player.batch && <span className="proj-mba">{player.batch}</span>}
        </div>

        {state.status === 'sold' && buyer && (
          <div className="proj-stamp sold" key={`sold-${state.updated_at}`} style={{ ['--team' as string]: buyer.color }}>
            <div className="stamp-word">SOLD</div>
            <div className="stamp-detail">
              to {buyer.name} for {pts(state.current_bid)} pts
            </div>
          </div>
        )}
        {state.status === 'unsold' && (
          <div className="proj-stamp unsold" key={`unsold-${state.updated_at}`}>
            <div className="stamp-word">UNSOLD</div>
          </div>
        )}
      </div>

      <TopBuys data={data} highlightId={state.status === 'sold' ? player.id : null} />
    </div>
  )
}

function TopBuys({ data, highlightId }: { data: AuctionData; highlightId: string | null }) {
  const teamsById = new Map(data.teams.map((t) => [t.id, t]))
  const top = data.players
    .filter((p) => p.status === 'sold')
    .sort((a, b) => (b.sold_price ?? 0) - (a.sold_price ?? 0) || (a.sold_at ?? '').localeCompare(b.sold_at ?? ''))
    .slice(0, 5)
  return (
    <aside className="proj-topbuys">
      <h2>Top 5 buys</h2>
      {top.length === 0 ? (
        <p className="proj-topbuys-empty">No players sold yet</p>
      ) : (
        <ol>
          {top.map((p, i) => {
            const team = p.team_id ? teamsById.get(p.team_id) : undefined
            return (
              <li
                key={p.id}
                className={p.id === highlightId ? 'fresh' : ''}
                style={{ ['--team' as string]: team?.color ?? '#334155' }}
              >
                <span className="rank">{i + 1}</span>
                <PlayerPhoto name={p.name} src={p.photo_url} className="avatar-topbuy" />
                <span className="who">
                  <strong>{p.name}</strong>
                  <span>{team?.name ?? ''}</span>
                </span>
                <span className="price">{pts(p.sold_price)}</span>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}

function IdleBoard({ data }: { data: AuctionData }) {
  const sold = data.players.filter((p) => p.status === 'sold')
  const totalSpent = sold.reduce((s, p) => s + (p.sold_price ?? 0), 0)
  const top = [...sold].sort((a, b) => (b.sold_price ?? 0) - (a.sold_price ?? 0)).slice(0, 5)
  const remaining = data.players.filter((p) => p.status !== 'sold').length
  const teamsById = new Map(data.teams.map((t) => [t.id, t]))
  const { state } = data
  const lot = currentLot(state)
  const heading =
    state.phase === 'setup'
      ? 'The auction is about to begin'
      : state.phase === 'ready'
        ? 'Lot order'
        : state.phase === 'ended'
          ? 'Auction complete'
          : state.phase === 'unsold'
            ? 'Unsold round: next player coming up'
            : lot
              ? `${lotLabel(lot)} lot: next player coming up`
              : 'Next player coming up'

  return (
    <div className="proj-idle">
      <h1>{heading}</h1>
      {state.phase === 'ready' && (
        <>
          <LotOrder state={state} />
          <p className="proj-idle-note">The auction begins shortly</p>
        </>
      )}
      {state.phase === 'lots' && <LotOrder state={state} compact />}
      {state.phase === 'unsold' && (
        <p className="proj-idle-note">Unsold players return in the order they went unsold</p>
      )}
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
                  <span className="name-with-avatar">
                    <PlayerPhoto name={p.name} src={p.photo_url} className="avatar-top" />
                    {p.name}
                  </span>
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
              {t.retained_owner && (
                <li className="proj-owner">
                  <span>{t.retained_owner} (owner)</span>
                  <strong>{pts(data.settings.retention_cost)}</strong>
                </li>
              )}
              {squad.map((p) => (
                <li key={p.id}>
                  <span className="name-with-avatar">
                    <PlayerPhoto name={p.name} src={p.photo_url} className="avatar-xs" />
                    {p.name}
                  </span>
                  <strong>{pts(p.sold_price)}</strong>
                </li>
              ))}
              {squad.length === 0 && !t.retained_owner && <li className="muted">No players yet</li>}
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
