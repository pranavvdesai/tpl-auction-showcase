export type Category = 'Marquee' | 'A' | 'B' | 'C'
export type Role = 'Batter' | 'Bowler' | 'All-rounder' | 'Wicketkeeper'
export type PlayerStatus = 'available' | 'sold' | 'unsold'
export type LotStatus = 'idle' | 'live' | 'sold' | 'unsold'
export type AuctionPhase = 'setup' | 'ready' | 'lots' | 'unsold' | 'ended'
export type Lot = 'Batter' | 'Bowler' | 'All-rounder'

export interface Settings {
  season_name: string
  min_squad: number
  max_squad: number
  min_base: number
  retention_cost: number
}

export interface TeamStanding {
  id: string
  name: string
  short_code: string
  color: string
  captain: string | null
  retained_owner: string | null
  sort_order: number
  purse_total: number
  spent: number
  remaining: number
  squad_count: number
  max_bid: number
  needed: number
}

export interface Player {
  id: string
  lot_no: number
  /** Order in which the player was drawn (1 = first on the floor); null until drawn. */
  draw_no: number | null
  name: string
  roll_no: string
  batch: string | null
  role: Role
  category: Category | null
  base_price: number
  batting_style: string | null
  bowling_style: string | null
  highlight: string | null
  is_wicketkeeper: boolean
  photo_url: string | null
  status: PlayerStatus
  team_id: string | null
  sold_price: number | null
  sold_at: string | null
  unsold_at: string | null
  reauctioned: boolean
}

export interface AuctionState {
  status: LotStatus
  current_player_id: string | null
  current_bid: number | null
  current_team_id: string | null
  updated_at: string
  phase: AuctionPhase
  lot_order: Lot[] | null
  /** 1-based index into lot_order */
  current_lot: number | null
  lot_order_drawn_at: string | null
  /** Overall round of the unsold players: 2 for their first return, 3+ while a team is still short */
  unsold_round: number | null
}

export interface AuctionData {
  settings: Settings
  teams: TeamStanding[]
  players: Player[]
  state: AuctionState
}
