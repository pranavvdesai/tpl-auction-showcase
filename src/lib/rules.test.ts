import { describe, expect, it } from 'vitest'
import { checkSale, computeStanding } from './rules'
import type { Settings } from './types'

const settings: Settings = { season_name: 'TPL 2026', min_squad: 8, max_squad: 10, min_base: 100 }

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

  it('blocks buying when the squad is full', () => {
    const s = computeStanding(10000, Array(10).fill(100), settings)
    expect(s.max_bid).toBe(0)
  })
})

describe('checkSale', () => {
  const standing = computeStanding(10000, [4000, 3000], settings)
  const base = { teamName: 'Pitch Placers', standing, basePrice: 300, settings }

  it('accepts a valid final amount', () => {
    expect(checkSale({ ...base, amount: 1250 })).toEqual({ ok: true })
  })

  it('accepts a sale at exactly the base price', () => {
    expect(checkSale({ ...base, amount: 300 })).toEqual({ ok: true })
  })

  it('rejects amounts below the base price', () => {
    expect(checkSale({ ...base, amount: 250 }).ok).toBe(false)
  })

  it('rejects amounts above the purse reserve limit', () => {
    // 3000 left, 5 more slots needed after this one => max 2500
    expect(standing.max_bid).toBe(2500)
    expect(checkSale({ ...base, amount: 2600 }).ok).toBe(false)
    expect(checkSale({ ...base, amount: 2500 }).ok).toBe(true)
  })

  it('rejects a team with a full squad', () => {
    const full = computeStanding(10000, Array(10).fill(100), settings)
    expect(checkSale({ ...base, standing: full, amount: 300 }).ok).toBe(false)
  })

  it('rejects non-integer amounts', () => {
    expect(checkSale({ ...base, amount: 400.5 }).ok).toBe(false)
  })
})
