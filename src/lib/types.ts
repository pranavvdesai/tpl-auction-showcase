export type Category = 'Marquee' | 'A' | 'B' | 'C'
export type Role = 'Batter' | 'Bowler' | 'All-rounder' | 'Wicketkeeper'
export type PlayerStatus = 'available' | 'sold' | 'unsold'
export type LotStatus = 'idle' | 'live' | 'sold' | 'unsold'

export interface Settings {
  season_name: string
  min_squad: number
  max_squad: number
  min_base: number
}

export interface TeamStanding {
  id: string
  name: string
  short_code: string
  color: string
  captain: string | null
  sort_order: number
  purse_total: number
  spent: number
  remaining: number
  squad_count: number
  max_bid: number
}

export interface Player {
  id: string
  lot_no: number
  name: string
  roll_no: string
  batch: string
  role: Role
  category: Category
  base_price: number
  batting_style: string | null
  bowling_style: string | null
  highlight: string | null
  status: PlayerStatus
  team_id: string | null
  sold_price: number | null
  sold_at: string | null
}

export interface Bid {
  id: number
  player_id: string
  team_id: string
  amount: number
  created_at: string
}

export interface AuctionState {
  status: LotStatus
  current_player_id: string | null
  current_bid: number | null
  current_team_id: string | null
  updated_at: string
}

export interface AuctionData {
  settings: Settings
  teams: TeamStanding[]
  players: Player[]
  state: AuctionState
  bids: Bid[]
}
