import { describe, expect, it } from 'vitest'
import { checkSale, computeStanding, floorToBid, isValidBid, nextBid, previousBid } from './rules'
import type { Settings } from './types'

const settings: Settings = { season_name: 'TPL 2026', min_squad: 13, max_squad: 16, min_base: 20, retention_cost: 200 }

describe('bidding ladder', () => {
  it('accepts steps of 10 up to 100 and steps of 20 above, with no 50s', () => {
    for (const ok of [10, 20, 90, 100, 120, 140, 300, 320, 340, 500, 1080]) expect(isValidBid(ok)).toBe(true)
    for (const bad of [0, 5, 15, 95, 110, 130, 150, 310, 350, 101]) expect(isValidBid(bad)).toBe(false)
  })

  it('steps up and down along the ladder', () => {
    expect(nextBid(10)).toBe(20)
    expect(nextBid(90)).toBe(100)
    expect(nextBid(100)).toBe(120)
    expect(nextBid(300)).toBe(320)
    expect(nextBid(110)).toBe(120)
    expect(previousBid(120)).toBe(100)
    expect(previousBid(100)).toBe(90)
    expect(previousBid(130)).toBe(120)
  })

  it('rounds a purse limit down to the nearest valid bid', () => {
    expect(floorToBid(1090)).toBe(1080)
    expect(floorToBid(95)).toBe(90)
    expect(floorToBid(7)).toBe(0)
  })
})

describe('team standing', () => {
  it('keeps the 20-point base price for every player still needed to reach 13', () => {
    const s = computeStanding(1200, [], settings)
    expect(s).toEqual({ spent: 0, remaining: 1200, squad_count: 0, max_bid: 1200 - 12 * 20, needed: 13 })
  })

  it('counts a retained owner as 200 points and one squad player', () => {
    const s = computeStanding(1200, [], settings, true)
    expect(s).toMatchObject({ spent: 200, remaining: 1000, squad_count: 1, needed: 12 })
    // 1000 - 11 * 20 = 780, already on the ladder
    expect(s.max_bid).toBe(780)
  })

  it('a team with 10 players and 90 points left can bid up to 50', () => {
    const s = computeStanding(1200, [...Array(9).fill(100), 210], settings)
    expect(s.remaining).toBe(90)
    expect(s.needed).toBe(3)
    expect(s.max_bid).toBe(50)
  })

  it('blocks buying when the squad has 16 players', () => {
    const s = computeStanding(1200, Array(15).fill(20), settings, true)
    expect(s.squad_count).toBe(16)
    expect(s.max_bid).toBe(0)
  })
})

describe('checkSale', () => {
  const standing = computeStanding(1200, [300, 200], settings)
  const base = { teamName: 'Pitch Placers', standing, basePrice: 20, settings }

  it('accepts valid final amounts, including the base price', () => {
    expect(checkSale({ ...base, amount: 240 })).toEqual({ ok: true })
    expect(checkSale({ ...base, amount: 20 })).toEqual({ ok: true })
  })

  it('rejects amounts below the 20-point base price', () => {
    expect(checkSale({ ...base, amount: 10 }).ok).toBe(false)
  })

  it('rejects amounts off the ladder and suggests the nearest valid bids', () => {
    const r = checkSale({ ...base, amount: 350 })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('340 or 360')
  })

  it('rejects amounts above the purse reserve limit', () => {
    // 700 left, 10 more players needed after this one at 20 each => 500
    expect(standing.max_bid).toBe(500)
    expect(checkSale({ ...base, amount: 520 }).ok).toBe(false)
    expect(checkSale({ ...base, amount: 500 }).ok).toBe(true)
  })

  it('rejects a team with a full squad', () => {
    const full = computeStanding(1200, Array(16).fill(20), settings)
    expect(checkSale({ ...base, standing: full, amount: 20 }).ok).toBe(false)
  })

  it('rejects non-integer amounts', () => {
    expect(checkSale({ ...base, amount: 40.5 }).ok).toBe(false)
  })
})
