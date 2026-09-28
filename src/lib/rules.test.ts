import { describe, expect, it } from 'vitest'
import { bidIncrement, checkBid, computeStanding, nextBidAmount } from './rules'
import type { Settings } from './types'

const settings: Settings = { season_name: 'TPL 2026', min_squad: 8, max_squad: 10, min_base: 100 }

describe('bid increments', () => {
  it('uses 50 below 1000, 100 below 3000, 200 above', () => {
    expect(bidIncrement(100)).toBe(50)
    expect(bidIncrement(950)).toBe(50)
    expect(bidIncrement(1000)).toBe(100)
    expect(bidIncrement(2900)).toBe(100)
    expect(bidIncrement(3000)).toBe(200)
  })

  it('opens at base price and then steps up', () => {
    expect(nextBidAmount(300, null)).toBe(300)
    expect(nextBidAmount(300, 300)).toBe(350)
    expect(nextBidAmount(300, 1000)).toBe(1100)
    expect(nextBidAmount(300, 3200)).toBe(3400)
  })
})

describe('team standing', () => {
  it('reserves minimum base price for the slots still needed to reach the minimum squad', () => {
    const s = computeStanding(10000, [], settings)
    expect(s).toEqual({ spent: 0, remaining: 10000, squad_count: 0, max_bid: 10000 - 7 * 100 })
  })

  it('stops reserving once the minimum squad is reachable with this purchase', () => {
    const s = computeStanding(10000, [500, 500, 500, 500, 500, 500, 500], settings)
    expect(s.remaining).toBe(6500)
    expect(s.max_bid).toBe(6500)
  })

  it('blocks bidding when the squad is full', () => {
    const s = computeStanding(10000, Array(10).fill(100), settings)
    expect(s.max_bid).toBe(0)
  })
})

describe('checkBid', () => {
  const standing = computeStanding(10000, [4000, 3000], settings)
  const base = { teamId: 't1', teamName: 'Pitch Placers', standing, minimum: 350, leadingTeamId: 't2', settings }

  it('accepts a valid bid', () => {
    expect(checkBid({ ...base, amount: 400 })).toEqual({ ok: true })
  })

  it('rejects bids below the minimum', () => {
    expect(checkBid({ ...base, amount: 300 }).ok).toBe(false)
  })

  it('rejects a team outbidding itself', () => {
    expect(checkBid({ ...base, amount: 400, leadingTeamId: 't1' }).ok).toBe(false)
  })

  it('rejects bids above the purse reserve limit', () => {
    // 3000 left, 5 more slots needed after this one => max bid 2500
    expect(standing.max_bid).toBe(2500)
    expect(checkBid({ ...base, amount: 2600 }).ok).toBe(false)
    expect(checkBid({ ...base, amount: 2500 }).ok).toBe(true)
  })

  it('rejects non-integer amounts', () => {
    expect(checkBid({ ...base, amount: 400.5 }).ok).toBe(false)
  })
})
