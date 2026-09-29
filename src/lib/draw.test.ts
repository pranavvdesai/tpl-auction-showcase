import { describe, expect, it } from 'vitest'
import { drawKey, lotLabel, pickRandomPlayer, shouldDraw, splitName } from './draw'

const at = '2026-09-29T10:00:00Z'

describe('drawKey', () => {
  it('is only set while a lot is live', () => {
    expect(drawKey({ status: 'live', current_player_id: 'p1', updated_at: at })).toBe(`p1:${at}`)
    expect(drawKey({ status: 'sold', current_player_id: 'p1', updated_at: at })).toBeNull()
    expect(drawKey({ status: 'unsold', current_player_id: 'p1', updated_at: at })).toBeNull()
    expect(drawKey({ status: 'idle', current_player_id: null, updated_at: at })).toBeNull()
    expect(drawKey(undefined)).toBeNull()
  })
})

describe('shouldDraw', () => {
  it('does not replay a lot that was already live when the page opened', () => {
    expect(shouldDraw(undefined, 'p1:t1')).toBe(false)
  })

  it('plays when a new player is put on the floor, including a re-auction', () => {
    expect(shouldDraw(null, 'p1:t1')).toBe(true)
    expect(shouldDraw('p1:t1', 'p2:t2')).toBe(true)
    expect(shouldDraw(null, 'p1:t3')).toBe(true)
  })

  it('does not play for the same lot, or when a lot ends', () => {
    expect(shouldDraw('p1:t1', 'p1:t1')).toBe(false)
    expect(shouldDraw('p1:t1', null)).toBe(false)
  })
})

describe('lotLabel', () => {
  it('uses the three auction groups', () => {
    expect(lotLabel('Batter')).toBe('Batsmen')
    expect(lotLabel('Wicketkeeper')).toBe('Batsmen')
    expect(lotLabel('Bowler')).toBe('Bowlers')
    expect(lotLabel('All-rounder')).toBe('All-rounders')
  })
})

describe('splitName', () => {
  it('keeps short names on one line', () => {
    expect(splitName('Aakash Bhatt')).toEqual(['Aakash Bhatt'])
    expect(splitName('Rudraksh')).toEqual(['Rudraksh'])
    expect(splitName('  Narayanan   Rm ')).toEqual(['Narayanan Rm'])
  })

  it('splits long names where the two lines balance best', () => {
    expect(splitName('Shivam Santosh Maurya')).toEqual(['Shivam', 'Santosh Maurya'])
    expect(splitName('Sarvanand Tekchandani')).toEqual(['Sarvanand', 'Tekchandani'])
    expect(splitName('Aditya Ganesh Danke')).toEqual(['Aditya', 'Ganesh Danke'])
    expect(splitName('Ashutosh Singh Thakur')).toEqual(['Ashutosh', 'Singh Thakur'])
  })

  it('never splits a single long word', () => {
    expect(splitName('Venkatasubramanian')).toEqual(['Venkatasubramanian'])
  })
})

describe('pickRandomPlayer', () => {
  const players = [
    { id: 'a', status: 'sold' as const },
    { id: 'b', status: 'available' as const },
    { id: 'c', status: 'unsold' as const },
    { id: 'd', status: 'available' as const },
  ]

  it('only picks available players while any are left', () => {
    expect(pickRandomPlayer(players, () => 0)?.id).toBe('b')
    expect(pickRandomPlayer(players, () => 0.999999)?.id).toBe('d')
  })

  it('falls back to unsold players for the final draft', () => {
    const rest = players.map((p) => (p.status === 'available' ? { ...p, status: 'sold' as const } : p))
    expect(pickRandomPlayer(rest, () => 0.5)?.id).toBe('c')
  })

  it('returns null when nobody is left', () => {
    expect(pickRandomPlayer([{ status: 'sold' as const }])).toBeNull()
  })

  it('spreads picks evenly', () => {
    const pool = Array.from({ length: 5 }, (_, i) => ({ id: i, status: 'available' as const }))
    const counts = new Map<number, number>()
    for (let i = 0; i < 5000; i++) {
      const id = pickRandomPlayer(pool, Math.random)!.id
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const n of counts.values()) expect(n).toBeGreaterThan(850)
    expect(counts.size).toBe(5)
  })
})
