// In-browser stand-in for the Supabase database, used only by the public demo build.
// Each function mirrors the latest definition in supabase/migrations (same checks, same
// messages); state lives in localStorage so the operator desk and projection screen stay in
// sync across tabs, the way Supabase Realtime keeps them in sync in production.
import type { AuctionPhase, AuctionState, Lot, LotStatus, Player, PlayerStatus, Role, Settings, TeamStanding } from '../lib/types'
import { seedPlayers, seedTeams, SEASON_NAME } from './seed'

const DB_KEY = 'tpl-auction-demo-db-v1'
const SESSION_KEY = 'tpl-auction-demo-session-v1'

export const DEMO_USERNAME = 'demo'
export const DEMO_PASSWORD = 'demo'
export const DEMO_EMAIL = 'demo@tpl-auction.invalid'

export interface TeamRow {
  id: string
  name: string
  short_code: string
  color: string
  captain: string | null
  retained_owner: string | null
  sort_order: number
  purse_total: number
}

interface StateRow extends AuctionState {
  id: 1
}

interface SettingsRow extends Settings {
  id: 1
}

export interface Db {
  settings: SettingsRow
  teams: TeamRow[]
  players: Player[]
  state: StateRow
  contacts: Record<string, string | null>
  photos: Record<string, string>
}

export class DbError extends Error {}

const fail = (message: string): never => {
  throw new DbError(message)
}

let lastStamp = 0
function now(): string {
  const t = Math.max(Date.now(), lastStamp + 1)
  lastStamp = t
  return new Date(t).toISOString()
}

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

function freshDb(): Db {
  const teams = seedTeams().map((t, i) => ({ ...t, id: uuid(), captain: null, retained_owner: null, sort_order: i + 1, purse_total: 1200 }))
  const players: Player[] = seedPlayers().map((p, i) => ({
    id: uuid(),
    lot_no: i + 1,
    draw_no: null,
    name: p.name,
    roll_no: p.roll_no,
    batch: p.batch,
    role: p.role,
    category: null,
    base_price: 20,
    batting_style: p.batting_style,
    bowling_style: p.bowling_style,
    highlight: null,
    is_wicketkeeper: p.role === 'Wicketkeeper',
    photo_url: null,
    status: 'available',
    team_id: null,
    sold_price: null,
    sold_at: null,
    unsold_at: null,
    reauctioned: false,
  }))
  return {
    settings: { id: 1, season_name: SEASON_NAME, min_squad: 13, max_squad: 16, min_base: 20, retention_cost: 200 },
    teams,
    players,
    state: {
      id: 1,
      status: 'idle',
      current_player_id: null,
      current_bid: null,
      current_team_id: null,
      updated_at: now(),
      phase: 'setup',
      lot_order: null,
      current_lot: null,
      lot_order_drawn_at: null,
    },
    contacts: {},
    photos: {},
  }
}

let db: Db = load()

function load(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) return JSON.parse(raw) as Db
  } catch {
    // Corrupt or blocked storage: start from the seed.
  }
  return freshDb()
}

type Listener = () => void
const listeners = new Set<Listener>()

export function onChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit() {
  window.setTimeout(() => listeners.forEach((l) => l()), 40)
}

function save() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    // Quota exceeded (large photos): keep the photos in memory only for this tab.
    try {
      localStorage.setItem(DB_KEY, JSON.stringify({ ...db, photos: {} }))
    } catch {
      // Storage unavailable; the demo still works within this tab.
    }
  }
  emit()
}

window.addEventListener('storage', (e) => {
  if (e.key === DB_KEY) {
    db = load()
    emit()
  }
  if (e.key === SESSION_KEY) authListeners.forEach((l) => l(signedIn() ? 'SIGNED_IN' : 'SIGNED_OUT'))
})

export function resetDemo() {
  db = freshDb()
  save()
}

// ---------------------------------------------------------------------------
// Auth (one demo operator account)
// ---------------------------------------------------------------------------

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT'
const authListeners = new Set<(event: AuthEvent) => void>()

export function signedIn(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return memorySession
  }
}
let memorySession = false

export function onAuth(listener: (event: AuthEvent) => void): () => void {
  authListeners.add(listener)
  return () => authListeners.delete(listener)
}

export function signIn(email: string, password: string): boolean {
  if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) return false
  memorySession = true
  try {
    localStorage.setItem(SESSION_KEY, '1')
  } catch {
    // memory only
  }
  authListeners.forEach((l) => l('SIGNED_IN'))
  return true
}

export function signOut() {
  memorySession = false
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // memory only
  }
  authListeners.forEach((l) => l('SIGNED_OUT'))
}

function assertOperator() {
  if (!signedIn()) fail('Only signed-in operators can do this.')
}

// ---------------------------------------------------------------------------
// Reads (tables and the team_standings view)
// ---------------------------------------------------------------------------

const isValidBid = (a: number | null | undefined) =>
  a != null && a >= 10 && (a <= 100 ? a % 10 === 0 : (a - 100) % 20 === 0)

const floorToBid = (a: number) => (a < 10 ? 0 : a <= 100 ? Math.floor(a / 10) * 10 : 100 + Math.floor((a - 100) / 20) * 20)

export function teamStandings(): TeamStanding[] {
  const s = db.settings
  return [...db.teams]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => {
      const bought = db.players.filter((p) => p.team_id === t.id && p.status === 'sold')
      const retained = t.retained_owner != null
      const spent = (retained ? s.retention_cost : 0) + bought.reduce((sum, p) => sum + (p.sold_price ?? 0), 0)
      const squad = bought.length + (retained ? 1 : 0)
      return {
        id: t.id,
        name: t.name,
        short_code: t.short_code,
        color: t.color,
        captain: t.captain,
        retained_owner: t.retained_owner,
        sort_order: t.sort_order,
        purse_total: t.purse_total,
        spent,
        remaining: t.purse_total - spent,
        squad_count: squad,
        max_bid: squad >= s.max_squad ? 0 : floorToBid(Math.max(t.purse_total - spent - Math.max(s.min_squad - squad - 1, 0) * s.min_base, 0)),
        needed: Math.max(s.min_squad - squad, 0),
      }
    })
}

function resolvePhoto(url: string | null): string | null {
  if (!url || !url.startsWith('demo-photo:')) return url
  const path = url.slice('demo-photo:'.length).split('?')[0]
  return db.photos[path] ?? null
}

export function readTable(table: string): unknown[] {
  switch (table) {
    case 'auction_settings':
      return [{ ...db.settings }]
    case 'auction_state':
      return [{ ...db.state }]
    case 'teams':
      return db.teams.map((t) => ({ ...t }))
    case 'team_standings':
      return teamStandings()
    case 'players':
      return db.players.map((p) => ({ ...p, photo_url: resolvePhoto(p.photo_url) }))
    case 'player_contacts':
      if (!signedIn()) return []
      return Object.entries(db.contacts).map(([roll_no, phone]) => ({ roll_no, phone }))
    default:
      return fail(`relation "public.${table}" does not exist`)
  }
}

export function savePhoto(path: string, dataUrl: string) {
  db.photos[path] = dataUrl
  save()
}

// ---------------------------------------------------------------------------
// Operations (mirrors of the SECURITY DEFINER functions)
// ---------------------------------------------------------------------------

const player = (id: string | null) => db.players.find((p) => p.id === id)
const standing = (teamId: string) => teamStandings().find((t) => t.id === teamId)
const inLot = (role: Role, lot: Lot) => role === lot || (lot === 'Batter' && role === 'Wicketkeeper')
const shuffle = <T,>(items: T[]) => {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function setState(patch: Partial<StateRow>) {
  db.state = { ...db.state, ...patch, updated_at: now() }
}

function teamsCanBuy() {
  const s = db.settings
  return teamStandings().some((t) => t.squad_count < s.max_squad && t.max_bid >= s.min_base)
}

function teamsShort() {
  const s = db.settings
  return teamStandings().some((t) => t.squad_count < s.min_squad && t.max_bid >= s.min_base)
}

function drawLotOrder() {
  assertOperator()
  if (db.state.phase !== 'setup') fail('The lot order has already been drawn.')
  if (db.players.some((p) => p.status !== 'available'))
    fail('Some players are already sold or unsold. Reset the auction before drawing the lot order.')
  setState({
    phase: 'ready',
    lot_order: shuffle<Lot>(['Batter', 'Bowler', 'All-rounder']),
    current_lot: null,
    lot_order_drawn_at: now(),
    status: 'idle',
    current_player_id: null,
    current_bid: null,
    current_team_id: null,
  })
  return { ...db.state }
}

function beginAuction() {
  assertOperator()
  if (db.state.phase !== 'ready') fail('Draw the lot order before beginning the auction.')
  setState({ phase: 'lots', current_lot: 1 })
  return { ...db.state }
}

function drawNextPlayer() {
  assertOperator()
  const st = db.state
  if (st.phase === 'setup' || st.phase === 'ready') fail('Draw the lot order and begin the auction first.')
  if (st.phase === 'ended') fail('The auction has ended.')
  if (st.status === 'live') fail('Close the current player (sold or unsold) before drawing the next one.')

  let pick: Player | undefined
  let lot: number | null = null
  let phase: AuctionPhase | null = null

  if (teamsCanBuy()) {
    const order = st.lot_order ?? []
    for (let i = 0; i < order.length; i++) {
      const pool = db.players.filter((p) => p.status === 'available' && inLot(p.role, order[i]))
      if (pool.length) {
        pick = pool[Math.floor(Math.random() * pool.length)]
        lot = i + 1
        phase = 'lots'
        break
      }
    }
    if (!phase) {
      const queue = db.players
        .filter((p) => p.status === 'unsold' && !p.reauctioned)
        .sort((a, b) => {
          if (a.unsold_at === b.unsold_at) return a.lot_no - b.lot_no
          if (a.unsold_at == null) return 1
          if (b.unsold_at == null) return -1
          return a.unsold_at < b.unsold_at ? -1 : 1
        })
      if (queue.length) {
        pick = queue[0]
        phase = 'unsold'
        pick.status = 'available'
        pick.reauctioned = true
      }
    }
  }

  if (!phase || !pick) {
    if (teamsShort() && db.players.some((p) => p.status === 'unsold'))
      fail('Round 2 is over. Give the unsold players to the teams below the minimum squad, then complete the auction.')
    setState({ phase: 'ended', status: 'idle', current_player_id: null, current_bid: null, current_team_id: null })
    return { ...db.state }
  }

  if (pick.draw_no == null) pick.draw_no = db.players.reduce((m, p) => Math.max(m, p.draw_no ?? 0), 0) + 1
  setState({
    phase,
    current_lot: lot ?? st.current_lot,
    status: 'live',
    current_player_id: pick.id,
    current_bid: null,
    current_team_id: null,
  })
  return { ...db.state }
}

function sellPlayer(teamId: string, amount: number | null) {
  assertOperator()
  const s = db.settings
  const st = db.state
  if (st.status !== 'live' || !st.current_player_id) fail('No player is on the floor. Start a player first.')
  const p = player(st.current_player_id)!
  if (amount == null || amount < p.base_price) fail(`Final amount must be at least the base price of ${p.base_price} points.`)
  if (!isValidBid(amount)) fail(`${amount} is not a valid bid. Bids rise in 10s up to 100, then in 20s (120, 140, 160 ...).`)
  const team = standing(teamId) ?? fail('Team not found.')
  if (team.squad_count >= s.max_squad) fail(`${team.name} already has a full squad.`)
  if (amount! > team.max_bid)
    fail(
      `${team.name} can spend at most ${team.max_bid} points (keeping ${s.min_base} points for each player still needed to reach ${s.min_squad} players).`,
    )
  Object.assign(p, { status: 'sold' as PlayerStatus, team_id: teamId, sold_price: amount, sold_at: now() })
  setState({ status: 'sold', current_bid: amount, current_team_id: teamId })
  return { ...db.state }
}

function markUnsold() {
  assertOperator()
  if (db.state.status !== 'live') fail('No player is on the floor.')
  const p = player(db.state.current_player_id)!
  p.status = 'unsold'
  p.unsold_at = p.unsold_at ?? now()
  setState({ status: 'unsold' })
  return { ...db.state }
}

function revertSale(playerId: string) {
  assertOperator()
  const p = player(playerId)
  if (!p || (p.status !== 'sold' && p.status !== 'unsold')) fail('Only sold or unsold players can be reverted.')
  const backToUnsold = p!.status === 'sold' && p!.reauctioned
  Object.assign(p!, {
    status: (backToUnsold ? 'unsold' : 'available') as PlayerStatus,
    unsold_at: backToUnsold ? p!.unsold_at : null,
    reauctioned: false,
    team_id: null,
    sold_price: null,
    sold_at: null,
  })
  if (db.state.current_player_id === playerId)
    setState({ status: 'idle', current_player_id: null, current_bid: null, current_team_id: null })
  return null
}

function endAuction() {
  assertOperator()
  const s = db.settings
  if (db.state.phase !== 'lots' && db.state.phase !== 'unsold') fail('The auction is not running.')
  if (db.state.status === 'live') fail('Close the current player (sold or unsold) before ending the auction.')
  const short = teamStandings()
    .filter((t) => t.squad_count < s.min_squad)
    .map((t) => `${t.name} (${t.squad_count}/${s.min_squad})`)
  if (short.length && db.players.some((p) => p.status === 'available' || p.status === 'unsold'))
    fail(`Every team needs at least the minimum squad before the auction can end. Short: ${short.join(', ')}`)
  setState({ phase: 'ended', status: 'idle', current_player_id: null, current_bid: null, current_team_id: null })
  return { ...db.state }
}

function allotPlayer(playerId: string, teamId: string) {
  assertOperator()
  const s = db.settings
  if (db.state.phase !== 'lots' && db.state.phase !== 'unsold') fail('The auction is not running.')
  if (db.state.status === 'live') fail('Close the current player (sold or unsold) first.')
  if (db.players.some((p) => p.status === 'available' || (p.status === 'unsold' && !p.reauctioned)))
    fail('Unsold players can only be given out after round 2 (the unsold round) is over.')
  const p = player(playerId)
  if (!p || p.status !== 'unsold') fail('That player is not on the unsold list.')
  const team = standing(teamId) ?? fail('Team not found.')
  if (team.squad_count >= s.min_squad)
    fail(`${team.name} already has ${team.squad_count} players. Only teams below ${s.min_squad} get unsold players.`)
  if (p!.base_price > team.max_bid) fail(`${team.name} cannot afford the base price of ${p!.base_price} points.`)
  Object.assign(p!, { status: 'sold' as PlayerStatus, team_id: teamId, sold_price: p!.base_price, sold_at: now() })
  setState({ status: 'sold', current_player_id: p!.id, current_bid: p!.base_price, current_team_id: teamId })
  return { ...db.state }
}

function assignUnsoldPlayer(playerId: string, teamId: string) {
  assertOperator()
  const s = db.settings
  if (!['lots', 'unsold', 'ended'].includes(db.state.phase)) fail('The auction has not started yet.')
  if (db.state.status === 'live') fail('Close the current player (sold or unsold) first.')
  const p = player(playerId)
  if (!p || p.status !== 'unsold') fail('That player is not on the unsold list.')
  const team = standing(teamId) ?? fail('Team not found.')
  if (team.squad_count >= s.max_squad) fail(`${team.name} already has the maximum of ${s.max_squad} players.`)
  Object.assign(p!, { status: 'sold' as PlayerStatus, team_id: teamId, sold_price: 0, sold_at: now(), reauctioned: true })
  return null
}

function resetAuction() {
  assertOperator()
  setState({
    status: 'idle',
    current_player_id: null,
    current_bid: null,
    current_team_id: null,
    phase: 'setup',
    lot_order: null,
    current_lot: null,
    lot_order_drawn_at: null,
  })
  for (const p of db.players)
    Object.assign(p, { status: 'available', team_id: null, sold_price: null, sold_at: null, unsold_at: null, reauctioned: false, draw_no: null })
  return null
}

function setRetainedOwner(teamId: string, owner: string | null) {
  assertOperator()
  if (db.players.some((p) => p.status === 'sold'))
    fail('Owner retention must be declared before the auction begins. Reset the auction to change it.')
  const t = db.teams.find((x) => x.id === teamId) ?? fail('Team not found.')
  t.retained_owner = owner?.trim() ? owner.trim() : null
  return null
}

interface ImportItem {
  name: string
  roll_no: string
  batch?: string | null
  role: Role
  category?: string | null
  base_price: number | string
  batting_style?: string | null
  bowling_style?: string | null
  highlight?: string | null
  is_wicketkeeper?: boolean | null
  photo_url?: string | null
}

const blank = (v: unknown) => {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}

function importPlayers(items: ImportItem[], replace = false) {
  assertOperator()
  if (!Array.isArray(items) || items.length === 0) fail('There are no players to import.')
  if (replace) {
    if (db.players.some((p) => p.status === 'sold'))
      fail('Some players are already sold. Reset the auction before replacing the player pool.')
    setState({ status: 'idle', current_player_id: null, current_bid: null, current_team_id: null })
    db.players = []
  }
  const next = db.players.reduce((m, p) => Math.max(m, p.lot_no), 0)
  let count = 0
  items.forEach((item, i) => {
    const roll = String(item.roll_no ?? '').trim().toUpperCase()
    const fields = {
      name: String(item.name ?? '').trim(),
      batch: blank(item.batch),
      role: item.role,
      base_price: Number(item.base_price),
      batting_style: blank(item.batting_style),
      bowling_style: blank(item.bowling_style),
      is_wicketkeeper: Boolean(item.is_wicketkeeper),
    }
    const existing = db.players.find((p) => p.roll_no === roll)
    if (existing) {
      Object.assign(existing, fields, {
        category: (blank(item.category) as Player['category']) ?? existing.category,
        highlight: blank(item.highlight) ?? existing.highlight,
        photo_url: blank(item.photo_url) ?? existing.photo_url,
      })
    } else {
      db.players.push({
        id: uuid(),
        lot_no: next + i + 1,
        draw_no: null,
        roll_no: roll,
        ...fields,
        category: blank(item.category) as Player['category'],
        highlight: blank(item.highlight),
        photo_url: blank(item.photo_url),
        status: 'available',
        team_id: null,
        sold_price: null,
        sold_at: null,
        unsold_at: null,
        reauctioned: false,
      })
    }
    count++
  })
  return count
}

function setPlayerPhotos(items: Array<{ roll_no: string; photo_url: string }>) {
  assertOperator()
  let count = 0
  for (const item of items) {
    const p = db.players.find((x) => x.roll_no === String(item.roll_no).trim().toUpperCase())
    if (p) {
      p.photo_url = item.photo_url
      count++
    }
  }
  return count
}

function saveContacts(items: Array<{ roll_no: string; phone: string | null }>) {
  assertOperator()
  if (!Array.isArray(items)) fail('Contacts must be a list.')
  let count = 0
  for (const e of items) {
    const roll = blank(e.roll_no)?.toUpperCase()
    if (!roll) continue
    db.contacts[roll] = blank(e.phone) ?? db.contacts[roll] ?? null
    count++
  }
  return count
}

type Args = Record<string, unknown>
const MUTATIONS: Record<string, (a: Args) => unknown> = {
  draw_lot_order: () => drawLotOrder(),
  begin_auction: () => beginAuction(),
  draw_next_player: () => drawNextPlayer(),
  sell_player: (a) => sellPlayer(a.p_team_id as string, a.p_amount as number),
  mark_unsold: () => markUnsold(),
  revert_sale: (a) => revertSale(a.p_player_id as string),
  end_auction: () => endAuction(),
  allot_player: (a) => allotPlayer(a.p_player_id as string, a.p_team_id as string),
  assign_unsold_player: (a) => assignUnsoldPlayer(a.p_player_id as string, a.p_team_id as string),
  reset_auction: () => resetAuction(),
  set_retained_owner: (a) => setRetainedOwner(a.p_team_id as string, a.p_owner as string | null),
  import_players: (a) => importPlayers(a.p_players as ImportItem[], Boolean(a.p_replace)),
  set_player_photos: (a) => setPlayerPhotos(a.p_items as Array<{ roll_no: string; photo_url: string }>),
  save_contacts: (a) => saveContacts(a.p_items as Array<{ roll_no: string; phone: string | null }>),
}

export function callRpc(name: string, args: Args = {}): unknown {
  if (name === 'is_operator') return signedIn()
  const fn = MUTATIONS[name] ?? fail(`Could not find the function public.${name}`)
  // Run against a copy so a failed call leaves the data untouched, like a rolled-back transaction.
  const snapshot = JSON.stringify(db)
  try {
    const result = fn(args)
    save()
    return result
  } catch (e) {
    db = JSON.parse(snapshot) as Db
    throw e
  }
}

// ---------------------------------------------------------------------------
// Demo helper: plays the lots with random bids, stopping when round 2 begins.
// ---------------------------------------------------------------------------

export function fastForwardToRoundTwo(): string {
  if (!signedIn()) signIn(DEMO_EMAIL, DEMO_PASSWORD)
  const step = (name: string, args?: Args) => callRpc(name, args)
  const phase = (): AuctionPhase => db.state.phase
  if (phase() === 'ended') return 'The auction has already ended. Reset the demo to start again.'
  if (phase() === 'setup') step('draw_lot_order')
  if (phase() === 'ready') step('begin_auction')
  for (let guard = 0; guard < 500; guard++) {
    if (db.state.status === 'live') {
      if (phase() === 'unsold') return 'Round 1 finished. Round 2 (the unsold round) is now on the floor.'
      const buyers = teamStandings().filter((t) => t.squad_count < db.settings.max_squad && t.max_bid >= db.settings.min_base)
      if (!buyers.length || Math.random() < 0.18) {
        step('mark_unsold')
        continue
      }
      const team = buyers[Math.floor(Math.random() * buyers.length)]
      const cap = Math.min(team.max_bid, 220)
      const ladder = [20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 220].filter((v) => v <= cap)
      step('sell_player', { p_team_id: team.id, p_amount: ladder[Math.floor(Math.random() ** 2 * ladder.length)] })
      continue
    }
    if (phase() === 'ended') return 'The auction ended during the lots.'
    try {
      step('draw_next_player')
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  return 'Stopped.'
}

export type { AuctionPhase, LotStatus }
