import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, supabase } from './supabase'
import type { AuctionData, AuctionState, Player, Settings, TeamStanding } from './types'

const WATCHED_TABLES = ['auction_state', 'players', 'teams'] as const
const FALLBACK_POLL_MS = 15000

async function fetchAuction(): Promise<AuctionData> {
  const [settings, teams, players, state] = await Promise.all([
    supabase.from('auction_settings').select('season_name, min_squad, max_squad, min_base, retention_cost').single(),
    supabase.from('team_standings').select('*').order('sort_order'),
    supabase.from('players').select('*').order('lot_no'),
    supabase
      .from('auction_state')
      .select('status, current_player_id, current_bid, current_team_id, updated_at, phase, lot_order, current_lot, lot_order_drawn_at, unsold_round')
      .single(),
  ])
  for (const result of [settings, teams, players, state]) {
    if (result.error) throw result.error
  }
  return {
    settings: settings.data as Settings,
    teams: teams.data as TeamStanding[],
    players: players.data as Player[],
    state: state.data as AuctionState,
  }
}

export function useAuction(channelName: string) {
  const [data, setData] = useState<AuctionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const requestId = useRef(0)

  const reload = useCallback(async () => {
    const id = ++requestId.current
    try {
      const next = await fetchAuction()
      if (id === requestId.current) {
        setData(next)
        setError(null)
      }
    } catch (e) {
      if (id === requestId.current) setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void reload()
    const schedule = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void reload(), 120)
    }
    let channel = supabase.channel(channelName)
    for (const table of WATCHED_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule)
    }
    channel.subscribe((status) => {
      setLive(status === 'SUBSCRIBED')
      if (status === 'SUBSCRIBED') schedule()
    })
    const poll = window.setInterval(() => void reload(), FALLBACK_POLL_MS)
    return () => {
      window.clearTimeout(timer.current)
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [channelName, reload])

  return { data, error, live, reload }
}
