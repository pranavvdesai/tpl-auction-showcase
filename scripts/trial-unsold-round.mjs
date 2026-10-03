// Rehearsal only: rewrites the LIVE auction into a late-auction state so the unsold round can be practised.
// Every lot is finished, squads are padded with "Trial Player NN" fillers, and 12 real players sit in the
// unsold list. Undo with "Reset demo auction" + re-import (Replace), or `node scripts/trial-unsold-round.mjs --undo`.
import { nodeClient } from './env.mjs'

const sb = nodeClient(process.env.SUPABASE_SERVICE_ROLE_KEY)
const FILLER_ROLL = 'TRIAL'

async function must(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

async function clearAuction() {
  await must(sb.from('players').delete().like('roll_no', `${FILLER_ROLL}%`))
  await must(
    sb
      .from('players')
      .update({ status: 'available', team_id: null, sold_price: null, sold_at: null, unsold_at: null, reauctioned: false, draw_no: null })
      .neq('roll_no', ''),
  )
}

if (process.argv.includes('--undo')) {
  await clearAuction()
  await must(
    sb
      .from('auction_state')
      .update({ status: 'idle', current_player_id: null, current_bid: null, current_team_id: null, phase: 'setup', lot_order: null, current_lot: null, lot_order_drawn_at: null, updated_at: new Date().toISOString() })
      .eq('id', 1),
  )
  console.log('Fillers removed and the auction is back to setup.')
  process.exit(0)
}

// squad size and total spend per team, in sort order
const PLAN = [
  { size: 16, spent: 1150 }, // full squad, out of the unsold round
  { size: 13, spent: 1000 }, // minimum met, can still add up to 3
  { size: 13, spent: 1120 }, // minimum met, almost no purse left
  { size: 10, spent: 600 }, // needs 3, plenty of purse
  { size: 10, spent: 950 },
  { size: 10, spent: 1080 }, // needs 3, nearly broke: can only pay base price
  { size: 10, spent: 800 },
  { size: 10, spent: 1000 },
]
const UNSOLD = { Batter: 4, Bowler: 3, 'All-rounder': 5 }

const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1])

// Valid bids: steps of 10 up to 100, then steps of 20.
function snap(x) {
  const v = Math.max(30, Math.round(x / 10) * 10)
  return v > 100 && (v - 100) % 20 ? v + 10 : v
}

function prices(count, total) {
  const weights = Array.from({ length: count }, () => Math.random() ** 2 + 0.1)
  const sum = weights.reduce((a, b) => a + b, 0)
  const out = weights.map((w) => snap(30 + ((total - 30 * count) * w) / sum))
  for (let guard = 0; guard < 500; guard++) {
    const diff = total - out.reduce((a, b) => a + b, 0)
    if (diff === 0) break
    const ok =
      diff >= 20 ? (v) => v >= 100
      : diff > 0 ? (v) => v <= 90
      : diff <= -20 ? (v) => v > 100
      : (v) => v > 30 && v <= 100
    const candidates = out.map((v, idx) => (ok(v) ? idx : -1)).filter((idx) => idx >= 0)
    if (candidates.length === 0) break
    const i = candidates[Math.floor(Math.random() * candidates.length)]
    out[i] += diff >= 20 ? 20 : diff > 0 ? 10 : diff <= -20 ? -20 : -10
  }
  return shuffle(out)
}

await clearAuction()
const teams = await must(sb.from('teams').select('id, name').order('sort_order'))
const real = shuffle(await must(sb.from('players').select('id, name, role, lot_no, photo_url')))
const { base_price } = (await must(sb.from('players').select('base_price').limit(1)))[0]

const unsold = []
for (const [role, n] of Object.entries(UNSOLD)) {
  const pool = real.filter((p) => (role === 'Batter' ? ['Batter', 'Wicketkeeper'] : [role]).includes(p.role) && p.photo_url)
  unsold.push(...pool.filter((p) => !unsold.includes(p)).slice(0, n))
}
const toSell = shuffle(real.filter((p) => !unsold.includes(p)))

const needed = PLAN.reduce((a, t) => a + t.size, 0)
const fillerCount = Math.max(0, needed - toSell.length)
const maxLot = Math.max(...real.map((p) => p.lot_no))
const fillerRoles = ['Batter', 'Bowler', 'All-rounder']
const fillers = await must(
  sb
    .from('players')
    .insert(
      Array.from({ length: fillerCount }, (_, i) => ({
        lot_no: maxLot + i + 1,
        name: `Trial Player ${String(i + 1).padStart(2, '0')}`,
        roll_no: `${FILLER_ROLL}${String(i + 1).padStart(2, '0')}`,
        role: fillerRoles[i % 3],
        base_price,
      })),
    )
    .select('id, name'),
)

// Real players first in each squad so the squads view shows faces.
const sellQueue = [...toSell, ...fillers]
const squads = PLAN.map(() => [])
let t = 0
for (const p of sellQueue) {
  while (squads[t % PLAN.length].length >= PLAN[t % PLAN.length].size) t++
  squads[t % PLAN.length].push(p)
  t++
}

const start = Date.now() - 3 * 60 * 60 * 1000
const sales = []
squads.forEach((squad, i) => {
  const ps = prices(squad.length, PLAN[i].spent)
  squad.forEach((p, j) => sales.push({ id: p.id, team_id: teams[i].id, sold_price: ps[j] }))
})
const timeline = shuffle([...sales.map((s) => ({ ...s, kind: 'sold' })), ...unsold.map((p) => ({ id: p.id, kind: 'unsold' }))])

let drawNo = 0
for (const item of timeline) {
  drawNo++
  const at = new Date(start + drawNo * 60_000).toISOString()
  const patch =
    item.kind === 'sold'
      ? { status: 'sold', team_id: item.team_id, sold_price: item.sold_price, sold_at: at, draw_no: drawNo }
      : { status: 'unsold', unsold_at: at, draw_no: drawNo }
  await must(sb.from('players').update(patch).eq('id', item.id))
}

const order = (await must(sb.from('auction_state').select('lot_order').eq('id', 1).single())).lot_order ?? ['Batter', 'Bowler', 'All-rounder']
await must(
  sb
    .from('auction_state')
    .update({
      phase: 'lots',
      lot_order: order,
      current_lot: order.length,
      lot_order_drawn_at: new Date(start).toISOString(),
      status: 'idle',
      current_player_id: null,
      current_bid: null,
      current_team_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1),
)

const standings = await must(sb.from('team_standings').select('name, squad_count, spent, remaining, max_bid').order('sort_order'))
console.table(standings)
console.log(`${fillers.length} fillers added. Unsold list (in re-auction order):`)
const unsoldNow = await must(sb.from('players').select('name, role, draw_no').eq('status', 'unsold').order('unsold_at'))
console.table(unsoldNow)
process.exit(0)
