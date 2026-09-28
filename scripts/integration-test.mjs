// End-to-end check of the auction database against the live Supabase project.
// WARNING: resets the (dummy) auction state before and after running.
import { OPERATOR_EMAIL, OPERATOR_PASSWORD, nodeClient } from './env.mjs'

let passed = 0
let failed = 0

async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL  ${name}\n        ${e.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectRpcError(client, fn, args, pattern) {
  const { error } = await client.rpc(fn, args)
  assert(error, `${fn} should have failed`)
  if (pattern) assert(pattern.test(error.message), `${fn} failed with unexpected message: ${error.message}`)
}

async function ok(promise) {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
}

const anon = nodeClient()
const op = nodeClient()

console.log('Public (anonymous) access')

let teams = []
let players = []

await check('anonymous users can read teams, players and auction state', async () => {
  teams = await ok(anon.from('team_standings').select('*').order('sort_order'))
  players = await ok(anon.from('players').select('*').order('lot_no'))
  const state = await ok(anon.from('auction_state').select('*').single())
  assert(teams.length === 8, `expected 8 teams, got ${teams.length}`)
  assert(players.length === 96, `expected 96 players, got ${players.length}`)
  assert(state.id === 1, 'auction_state row missing')
})

await check('anonymous users cannot insert bids directly', async () => {
  const { error } = await anon.from('bids').insert({ player_id: players[0].id, team_id: teams[0].id, amount: 999 })
  assert(error, 'insert should be rejected')
})

await check('anonymous users cannot update players directly', async () => {
  const { data, error } = await anon.from('players').update({ status: 'sold' }).eq('id', players[0].id).select()
  assert(error || (data ?? []).length === 0, 'update should be rejected')
})

await check('anonymous users cannot call auction functions', async () => {
  await expectRpcError(anon, 'start_lot', { p_player_id: players[0].id })
  await expectRpcError(anon, 'reset_auction', {})
})

console.log('Operator flow')

await check('operator can sign in and is recognised as operator', async () => {
  await ok(op.auth.signInWithPassword({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD }))
  const isOp = await ok(op.rpc('is_operator'))
  assert(isOp === true, 'is_operator returned false')
})

const [teamA, teamB] = teams
const standing = async (teamId) => ok(anon.from('team_standings').select('*').eq('id', teamId).single())
const state = async () => ok(anon.from('auction_state').select('*').single())

await check('reset clears the auction', async () => {
  await ok(op.rpc('reset_auction'))
  const s = await state()
  assert(s.status === 'idle' && s.current_player_id === null, 'state not idle after reset')
})

const marquee = players.find((p) => p.category === 'Marquee')
const setA = players.find((p) => p.category === 'A')
const setB = players.find((p) => p.category === 'B')
const setC = players.find((p) => p.category === 'C')

let realtimeEvents = 0
const channel = anon
  .channel('integration-test')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_state' }, () => realtimeEvents++)
await new Promise((resolve) => {
  const t = setTimeout(resolve, 8000)
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      clearTimeout(t)
      resolve()
    }
  })
})

await check('starting a lot opens bidding at the base price', async () => {
  await ok(op.rpc('start_lot', { p_player_id: marquee.id }))
  await ok(op.rpc('place_bid', { p_team_id: teamA.id }))
  const s = await state()
  assert(s.status === 'live', 'lot not live')
  assert(s.current_bid === marquee.base_price, `first bid should be base price ${marquee.base_price}, got ${s.current_bid}`)
  assert(s.current_team_id === teamA.id, 'team A should lead')
})

await check('a team cannot outbid itself', async () => {
  await expectRpcError(op, 'place_bid', { p_team_id: teamA.id }, /already holds/)
})

await check('bids below the next increment are rejected', async () => {
  await expectRpcError(op, 'place_bid', { p_team_id: teamB.id, p_amount: marquee.base_price + 20 }, /at least/)
})

await check('another lot cannot start while one is live', async () => {
  await expectRpcError(op, 'start_lot', { p_player_id: setA.id }, /Close the current lot/)
})

await check('undo restores the previous highest bid', async () => {
  await ok(op.rpc('place_bid', { p_team_id: teamB.id }))
  let s = await state()
  assert(s.current_bid === marquee.base_price + 50, `expected ${marquee.base_price + 50}, got ${s.current_bid}`)
  await ok(op.rpc('undo_bid'))
  s = await state()
  assert(s.current_bid === marquee.base_price && s.current_team_id === teamA.id, 'undo did not restore team A bid')
})

await check('selling assigns the player and deducts the purse', async () => {
  await ok(op.rpc('place_bid', { p_team_id: teamB.id, p_amount: 700 }))
  await expectRpcError(op, 'mark_unsold', {}, /has bids/)
  await ok(op.rpc('sell_lot'))
  const p = await ok(anon.from('players').select('*').eq('id', marquee.id).single())
  assert(p.status === 'sold' && p.team_id === teamB.id && p.sold_price === 700, 'player not sold correctly')
  const b = await standing(teamB.id)
  assert(b.spent === 700 && b.remaining === 9300 && b.squad_count === 1, 'team B standing wrong')
  assert(b.max_bid === 9300 - 6 * 100, `team B max bid should be 8700, got ${b.max_bid}`)
})

await check('a sold player cannot be auctioned again', async () => {
  await expectRpcError(op, 'start_lot', { p_player_id: marquee.id }, /already sold/)
})

await check('a player with no bids can be marked unsold and re-auctioned', async () => {
  await ok(op.rpc('start_lot', { p_player_id: setC.id }))
  await expectRpcError(op, 'sell_lot', {}, /No bids/)
  await ok(op.rpc('mark_unsold'))
  let p = await ok(anon.from('players').select('status').eq('id', setC.id).single())
  assert(p.status === 'unsold', 'player not unsold')
  await ok(op.rpc('start_lot', { p_player_id: setC.id }))
  p = await ok(anon.from('players').select('status').eq('id', setC.id).single())
  assert(p.status === 'available', 're-auctioned player should be available')
  await ok(op.rpc('mark_unsold'))
})

await check('bids above the purse reserve limit are rejected', async () => {
  await ok(op.rpc('start_lot', { p_player_id: setB.id }))
  await expectRpcError(op, 'place_bid', { p_team_id: teamB.id, p_amount: 9000 }, /at most 8700/)
  await ok(op.rpc('place_bid', { p_team_id: teamB.id, p_amount: 8700 }))
  await ok(op.rpc('undo_bid'))
  await ok(op.rpc('mark_unsold'))
})

await check('reverting a sale returns the player and refunds the team', async () => {
  await ok(op.rpc('revert_sale', { p_player_id: marquee.id }))
  const p = await ok(anon.from('players').select('*').eq('id', marquee.id).single())
  assert(p.status === 'available' && p.team_id === null, 'player not reverted')
  const b = await standing(teamB.id)
  assert(b.spent === 0 && b.squad_count === 0, 'team B not refunded')
})

await check('projection clients receive live updates', async () => {
  await new Promise((r) => setTimeout(r, 1500))
  assert(realtimeEvents > 0, 'no realtime events received for auction_state')
})

await check('final reset leaves a clean demo state', async () => {
  await ok(op.rpc('reset_auction'))
  const sold = await ok(anon.from('players').select('id').neq('status', 'available'))
  const bids = await ok(anon.from('bids').select('id'))
  assert(sold.length === 0 && bids.length === 0, 'demo state not clean')
})

await anon.removeChannel(channel)
await op.auth.signOut()

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
