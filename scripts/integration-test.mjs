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

await check('anonymous users cannot update players directly', async () => {
  const { data, error } = await anon.from('players').update({ status: 'sold' }).eq('id', players[0].id).select()
  assert(error || (data ?? []).length === 0, 'update should be rejected')
})

await check('anonymous users cannot change the auction state directly', async () => {
  const { data, error } = await anon.from('auction_state').update({ status: 'live' }).eq('id', 1).select()
  assert(error || (data ?? []).length === 0, 'update should be rejected')
})

await check('anonymous users cannot call auction functions', async () => {
  await expectRpcError(anon, 'start_lot', { p_player_id: players[0].id })
  await expectRpcError(anon, 'sell_player', { p_team_id: teams[0].id, p_amount: 500 })
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
const player = async (id) => ok(anon.from('players').select('*').eq('id', id).single())

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

await check('selling needs a player on the floor', async () => {
  await expectRpcError(op, 'sell_player', { p_team_id: teamA.id, p_amount: 500 }, /No player is on the floor/)
})

await check('starting a player puts them on the floor with no price yet', async () => {
  await ok(op.rpc('start_lot', { p_player_id: marquee.id }))
  const s = await state()
  assert(s.status === 'live' && s.current_player_id === marquee.id, 'player not live')
  assert(s.current_bid === null && s.current_team_id === null, 'live lot should have no amount or team')
})

await check('another player cannot start while one is on the floor', async () => {
  await expectRpcError(op, 'start_lot', { p_player_id: setA.id }, /Close the current lot/)
})

await check('final amount below the base price is rejected', async () => {
  await expectRpcError(op, 'sell_player', { p_team_id: teamB.id, p_amount: marquee.base_price - 1 }, /at least the base price/)
})

await check('final amount above the team purse limit is rejected', async () => {
  await expectRpcError(op, 'sell_player', { p_team_id: teamB.id, p_amount: 9301 }, /at most 9300/)
})

await check('selling records the team and final amount, and deducts the purse', async () => {
  await ok(op.rpc('sell_player', { p_team_id: teamB.id, p_amount: 1250 }))
  const p = await player(marquee.id)
  assert(p.status === 'sold' && p.team_id === teamB.id && p.sold_price === 1250, 'player not sold correctly')
  const s = await state()
  assert(s.status === 'sold' && s.current_bid === 1250 && s.current_team_id === teamB.id, 'state does not show the sale')
  const b = await standing(teamB.id)
  assert(b.spent === 1250 && b.remaining === 8750 && b.squad_count === 1, 'team B standing wrong')
  assert(b.max_bid === 8750 - 6 * 100, `team B max should be 8150, got ${b.max_bid}`)
})

await check('a sold player cannot be sold again or re-auctioned', async () => {
  await expectRpcError(op, 'sell_player', { p_team_id: teamA.id, p_amount: 600 }, /No player is on the floor/)
  await expectRpcError(op, 'start_lot', { p_player_id: marquee.id }, /already sold/)
})

await check('a player can be marked unsold and re-auctioned later', async () => {
  await ok(op.rpc('start_lot', { p_player_id: setC.id }))
  await ok(op.rpc('mark_unsold'))
  let p = await player(setC.id)
  assert(p.status === 'unsold', 'player not unsold')
  await ok(op.rpc('start_lot', { p_player_id: setC.id }))
  p = await player(setC.id)
  assert(p.status === 'available', 're-auctioned player should be available')
  await ok(op.rpc('sell_player', { p_team_id: teamA.id, p_amount: setC.base_price }))
  p = await player(setC.id)
  assert(p.status === 'sold' && p.sold_price === setC.base_price, 'sale at base price failed')
})

await check('a player can be taken off the screen without a result', async () => {
  await ok(op.rpc('start_lot', { p_player_id: setB.id }))
  await ok(op.rpc('cancel_lot'))
  const s = await state()
  const p = await player(setB.id)
  assert(s.status === 'idle' && s.current_player_id === null, 'state should be idle')
  assert(p.status === 'available', 'player should still be available')
})

await check('reverting a sale returns the player and refunds the team', async () => {
  await ok(op.rpc('revert_sale', { p_player_id: marquee.id }))
  const p = await player(marquee.id)
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
  const notAvailable = await ok(anon.from('players').select('id').neq('status', 'available'))
  const s = await state()
  assert(notAvailable.length === 0 && s.status === 'idle', 'demo state not clean')
})

await anon.removeChannel(channel)
await op.auth.signOut()

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
