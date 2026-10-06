// End-to-end check of the auction database against the live Supabase project.
// Works with any player pool (dummy seed or an imported sheet).
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

const floorToBid = (a) => (a < 10 ? 0 : a <= 100 ? Math.floor(a / 10) * 10 : 100 + Math.floor((a - 100) / 20) * 20)

async function ok(promise) {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
}

const anon = nodeClient()
const op = nodeClient()
const BUCKET = 'player-photos'
const TEST_ROLL = 'ZZTEST01'
const TEST_PHOTO = '__integration-test.png'
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const testPlayer = {
  name: 'Integration Test Player',
  roll_no: TEST_ROLL,
  batch: null,
  role: 'Bowler',
  base_price: 100,
  batting_style: 'Right-hand bat',
  bowling_style: 'Right-arm pace',
  is_wicketkeeper: true,
  photo_url: null,
}

console.log('Public (anonymous) access')

let teams = []
let players = []
let settings

await check('anonymous users can read settings, teams, players and auction state', async () => {
  settings = await ok(anon.from('auction_settings').select('*').single())
  teams = await ok(anon.from('team_standings').select('*').order('sort_order'))
  players = await ok(anon.from('players').select('*').order('lot_no'))
  const state = await ok(anon.from('auction_state').select('*').single())
  assert(teams.length === 8, `expected 8 teams, got ${teams.length}`)
  assert(players.length >= 3, `expected at least 3 players in the pool, got ${players.length}`)
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

await check('anonymous users cannot call auction or import functions', async () => {
  for (const fn of ['draw_lot_order', 'begin_auction', 'draw_next_player', 'end_auction', 'mark_unsold']) {
    await expectRpcError(anon, fn, {})
  }
  await expectRpcError(anon, 'sell_player', { p_team_id: teams[0].id, p_amount: 500 })
  await expectRpcError(anon, 'reset_auction', {})
  await expectRpcError(anon, 'import_players', { p_players: [testPlayer], p_replace: false })
  await expectRpcError(anon, 'set_player_photos', { p_items: [{ roll_no: TEST_ROLL, photo_url: 'x' }] })
  await expectRpcError(anon, 'remove_player', { p_player_id: players[0].id })
  await expectRpcError(anon, 'set_retained_owner', { p_team_id: teams[0].id, p_owner: 'x' })
})

await check('settings follow the rulebook', async () => {
  assert(settings.min_squad === 13 && settings.max_squad === 16, 'squad should be 13-16')
  assert(settings.min_base === 20 && settings.retention_cost === 200, 'base 20 and retention 200 expected')
  assert(players.every((p) => p.base_price === 20), 'every player should start at 20')
  assert(teams.every((t) => t.purse_total === 1200), 'every purse should be 1200')
})

await check('anonymous users cannot upload player photos', async () => {
  const { error } = await anon.storage.from(BUCKET).upload(TEST_PHOTO, PNG, { contentType: 'image/png', upsert: true })
  assert(error, 'anonymous upload should be rejected')
})

console.log('Operator flow')

await check('operator can sign in and is recognised as operator', async () => {
  await ok(op.auth.signInWithPassword({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD }))
  const isOp = await ok(op.rpc('is_operator'))
  assert(isOp === true, 'is_operator returned false')
})

await check('operator can upload a photo that is publicly readable, then delete it', async () => {
  await ok(op.storage.from(BUCKET).upload(TEST_PHOTO, PNG, { contentType: 'image/png', upsert: true }))
  const url = anon.storage.from(BUCKET).getPublicUrl(TEST_PHOTO).data.publicUrl
  const res = await fetch(url)
  assert(res.ok, `public photo URL returned ${res.status}`)
  await ok(op.storage.from(BUCKET).remove([TEST_PHOTO]))
})

await check('operator can merge-import a player and remove them again', async () => {
  const count = await ok(op.rpc('import_players', { p_players: [testPlayer], p_replace: false }))
  assert(count === 1, `expected 1 imported row, got ${count}`)
  const p = await ok(anon.from('players').select('*').eq('roll_no', TEST_ROLL).single())
  assert(p.is_wicketkeeper === true && p.role === 'Bowler' && p.category === null, 'imported fields wrong')
  assert(p.lot_no > Math.max(...players.map((x) => x.lot_no)), 'imported player should be appended to the end')
  const again = await ok(op.rpc('import_players', { p_players: [{ ...testPlayer, name: 'Renamed Test' }], p_replace: false }))
  assert(again === 1, 're-import should update, not duplicate')
  const renamed = await ok(anon.from('players').select('id, name').eq('roll_no', TEST_ROLL))
  assert(renamed.length === 1 && renamed[0].name === 'Renamed Test', 're-import did not update the existing row')
  await ok(op.rpc('remove_player', { p_player_id: renamed[0].id }))
  const gone = await ok(anon.from('players').select('id').eq('roll_no', TEST_ROLL))
  assert(gone.length === 0, 'test player was not removed')
})

const [teamA, teamB] = teams
const standing = async (teamId) => ok(anon.from('team_standings').select('*').eq('id', teamId).single())
const state = async () => ok(anon.from('auction_state').select('*').single())
const player = async (id) => ok(anon.from('players').select('*').eq('id', id).single())

const LOTS = ['Batter', 'Bowler', 'All-rounder']
const inLot = (role, lot) => role === lot || (lot === 'Batter' && role === 'Wicketkeeper')
const byId = new Map(players.map((p) => [p.id, p]))
const lotIndex = (order, id) => order.findIndex((lot) => inLot(byId.get(id).role, lot))

await check('reset clears the auction back to setup', async () => {
  await ok(op.rpc('reset_auction'))
  const s = await state()
  assert(s.status === 'idle' && s.current_player_id === null, 'state not idle after reset')
  assert(s.phase === 'setup' && s.lot_order === null && s.current_lot === null, 'phase not reset')
})

await check('retaining a playing owner costs 200 points and fills one squad place', async () => {
  await ok(op.rpc('set_retained_owner', { p_team_id: teamA.id, p_owner: '  Test Owner ' }))
  const a = await standing(teamA.id)
  assert(a.retained_owner === 'Test Owner', 'owner name not stored')
  assert(a.spent === 200 && a.remaining === 1000 && a.squad_count === 1 && a.needed === 12, 'retention not applied')
  assert(a.max_bid === floorToBid(1000 - 11 * settings.min_base), `max bid wrong: ${a.max_bid}`)
})

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

await check('players cannot be drawn before the lot order is drawn and the auction begins', async () => {
  await expectRpcError(op, 'draw_next_player', {}, /Draw the lot order/)
  await expectRpcError(op, 'begin_auction', {}, /Draw the lot order/)
  await expectRpcError(op, 'end_auction', {}, /not running/)
})

let order = []
await check('drawing the lot order shuffles the three lots once', async () => {
  const s = await ok(op.rpc('draw_lot_order'))
  order = s.lot_order
  assert(s.phase === 'ready' && s.lot_order_drawn_at && s.status === 'idle', 'lot order not drawn')
  assert(order.length === 3 && LOTS.every((l) => order.includes(l)), `bad lot order: ${order}`)
  await expectRpcError(op, 'draw_lot_order', {}, /already been drawn/)
  await expectRpcError(op, 'draw_next_player', {}, /begin the auction/)
})

await check('beginning the auction opens the first lot', async () => {
  const s = await ok(op.rpc('begin_auction'))
  assert(s.phase === 'lots' && s.current_lot === 1 && s.status === 'idle', 'auction did not begin')
  await expectRpcError(op, 'begin_auction', {}, /Draw the lot order/)
})

let first
await check('the next player is drawn at random from the first lot that has players', async () => {
  const s = await ok(op.rpc('draw_next_player'))
  const expected = order.findIndex((lot) => players.some((p) => inLot(p.role, lot)))
  assert(s.status === 'live' && s.current_player_id, 'no player on the floor')
  assert(lotIndex(order, s.current_player_id) === expected, 'player is not from the first lot')
  assert(s.current_lot === expected + 1, `current lot should be ${expected + 1}, got ${s.current_lot}`)
  assert(s.current_bid === null && s.current_team_id === null, 'live player should have no amount or team')
  first = byId.get(s.current_player_id)
})

await check('another player cannot be drawn while one is on the floor', async () => {
  await expectRpcError(op, 'draw_next_player', {}, /Close the current player/)
  await expectRpcError(op, 'end_auction', {}, /Close the current player/)
})

await check('final amount below the base price is rejected', async () => {
  await expectRpcError(op, 'sell_player', { p_team_id: teamB.id, p_amount: first.base_price - 1 }, /at least the base price/)
})

await check('final amounts off the 10/20 bidding ladder are rejected', async () => {
  for (const amount of [45, 110, 350]) {
    await expectRpcError(op, 'sell_player', { p_team_id: teamB.id, p_amount: amount }, /not a valid bid/)
  }
})

await check('final amount above the team purse limit is rejected', async () => {
  const b = await standing(teamB.id)
  await expectRpcError(op, 'sell_player', { p_team_id: teamB.id, p_amount: b.max_bid + 20 }, new RegExp(`at most ${b.max_bid}\\b`))
})

let saleAmount = 0
await check('selling records the team and final amount, and deducts the purse', async () => {
  saleAmount = 240
  await ok(op.rpc('sell_player', { p_team_id: teamB.id, p_amount: saleAmount }))
  const p = await player(first.id)
  assert(p.status === 'sold' && p.team_id === teamB.id && p.sold_price === saleAmount, 'player not sold correctly')
  const s = await state()
  assert(s.status === 'sold' && s.current_bid === saleAmount && s.current_team_id === teamB.id, 'state does not show the sale')
  const b = await standing(teamB.id)
  const remaining = b.purse_total - saleAmount
  assert(b.spent === saleAmount && b.remaining === remaining && b.squad_count === 1, 'team B standing wrong')
  const expected = floorToBid(remaining - Math.max(settings.min_squad - 2, 0) * settings.min_base)
  assert(b.max_bid === expected, `team B max should be ${expected}, got ${b.max_bid}`)
})

await check('owner retention cannot change once the auction has started', async () => {
  await expectRpcError(op, 'set_retained_owner', { p_team_id: teamA.id, p_owner: '' }, /before the auction begins/)
})

await check('a sold player cannot be sold again or removed', async () => {
  await expectRpcError(op, 'sell_player', { p_team_id: teamA.id, p_amount: 600 }, /No player is on the floor/)
  await expectRpcError(op, 'remove_player', { p_player_id: first.id }, /already sold/)
})

await check('the player pool cannot be replaced once a player is sold', async () => {
  await expectRpcError(op, 'import_players', { p_players: [testPlayer], p_replace: true }, /already sold/)
  const stillThere = await ok(anon.from('players').select('id'))
  assert(stillThere.length === players.length, 'pool changed after a refused replace')
})

// Every remaining lot player goes unsold, so the unsold round follows.
const unsoldOrder = []
let firstUnsoldRound = null
await check('lots are drawn strictly in the drawn order, every player exactly once', async () => {
  const seen = new Set([first.id])
  let lastLot = lotIndex(order, first.id)
  for (let i = 0; i < players.length + 1; i++) {
    const s = await ok(op.rpc('draw_next_player'))
    if (s.phase !== 'lots') {
      firstUnsoldRound = s
      break
    }
    const id = s.current_player_id
    assert(!seen.has(id), 'a player was drawn twice')
    seen.add(id)
    const lot = lotIndex(order, id)
    assert(lot >= lastLot, 'a later lot was drawn before an earlier lot was finished')
    assert(s.current_lot === lot + 1, 'current lot does not match the drawn player')
    lastLot = lot
    await ok(op.rpc('mark_unsold'))
    unsoldOrder.push(id)
  }
  assert(seen.size === players.length, `expected ${players.length} players drawn, got ${seen.size}`)
  const p = await player(unsoldOrder.at(-1))
  assert(p.status === 'unsold' && p.unsold_at && !p.reauctioned, 'unsold player not recorded')
})

await check('the unsold round starts with the first player to go unsold', async () => {
  const s = firstUnsoldRound
  assert(s && s.phase === 'unsold' && s.status === 'live', 'unsold round did not start')
  assert(s.current_player_id === unsoldOrder[0], 'unsold round did not start with the first unsold player')
  const p = await player(unsoldOrder[0])
  assert(p.status === 'available' && p.reauctioned, 'player should be back on the floor, marked re-auctioned')
})

await check('an unsold player can be sold in the unsold round, and a revert puts them back in the queue', async () => {
  const id = unsoldOrder[0]
  await ok(op.rpc('sell_player', { p_team_id: teamA.id, p_amount: settings.min_base }))
  let p = await player(id)
  assert(p.status === 'sold' && p.sold_price === settings.min_base, 'sale at base price failed')
  await ok(op.rpc('revert_sale', { p_player_id: id }))
  p = await player(id)
  assert(p.status === 'unsold' && p.unsold_at && !p.reauctioned, 'reverted unsold-round sale should rejoin the queue')
  const s = await ok(op.rpc('draw_next_player'))
  assert(s.current_player_id === id, 'reverted player should be first in the queue again')
})

await check('a player unsold again is not brought back a second time', async () => {
  await ok(op.rpc('mark_unsold'))
  const s = await ok(op.rpc('draw_next_player'))
  assert(s.phase === 'unsold' && s.current_player_id === unsoldOrder[1], 'next unsold player should follow')
  await ok(op.rpc('mark_unsold'))
})

await check('the operator can end the auction, and nothing can be drawn afterwards', async () => {
  const s = await ok(op.rpc('end_auction'))
  assert(s.phase === 'ended' && s.status === 'idle', 'auction not ended')
  await expectRpcError(op, 'draw_next_player', {}, /has ended/)
  await expectRpcError(op, 'end_auction', {}, /not running/)
})

await check('reverting a sale returns the player and refunds the team', async () => {
  await ok(op.rpc('revert_sale', { p_player_id: first.id }))
  const p = await player(first.id)
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
  assert(notAvailable.length === 0 && s.status === 'idle' && s.phase === 'setup', 'demo state not clean')
  const flagged = await ok(anon.from('players').select('id').or('reauctioned.eq.true,unsold_at.not.is.null'))
  assert(flagged.length === 0, 'unsold history not cleared')
  await ok(op.rpc('set_retained_owner', { p_team_id: teamA.id, p_owner: '' }))
  const a = await standing(teamA.id)
  assert(a.retained_owner === null && a.spent === 0, 'test retention not cleared')
})

await anon.removeChannel(channel)
await op.auth.signOut()

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
