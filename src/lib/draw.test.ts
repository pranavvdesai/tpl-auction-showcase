import { describe, expect, it } from 'vitest'
import { currentLot, drawKey, inLot, lotLabel, lotOrderKey, remaining, shouldDraw, splitName } from './draw'

const at = '2026-09-29T10:00:00Z'

describe('drawKey', () => {
  it('is only set while a player drawn from a lot is live', () => {
    expect(drawKey({ phase: 'lots', status: 'live', current_player_id: 'p1', updated_at: at })).toBe(`p1:${at}`)
    expect(drawKey({ phase: 'lots', status: 'sold', current_player_id: 'p1', updated_at: at })).toBeNull()
    expect(drawKey({ phase: 'lots', status: 'unsold', current_player_id: 'p1', updated_at: at })).toBeNull()
    expect(drawKey({ phase: 'lots', status: 'idle', current_player_id: null, updated_at: at })).toBeNull()
    expect(drawKey(undefined)).toBeNull()
  })

  it('has no draw animation in the unsold round', () => {
    expect(drawKey({ phase: 'unsold', status: 'live', current_player_id: 'p1', updated_at: at })).toBeNull()
  })
})

describe('lotOrderKey', () => {
  it('is set once the lot order has been drawn', () => {
    expect(lotOrderKey({ phase: 'ready', lot_order: ['Bowler', 'Batter', 'All-rounder'], lot_order_drawn_at: at })).toBe(at)
    expect(lotOrderKey({ phase: 'lots', lot_order: ['Bowler', 'Batter', 'All-rounder'], lot_order_drawn_at: at })).toBe(at)
    expect(lotOrderKey({ phase: 'setup', lot_order: null, lot_order_drawn_at: null })).toBeNull()
  })
})

describe('shouldDraw', () => {
  it('does not replay anything that was already on screen when the page opened', () => {
    expect(shouldDraw(undefined, 'p1:t1')).toBe(false)
  })

  it('plays when something new is drawn', () => {
    expect(shouldDraw(null, 'p1:t1')).toBe(true)
    expect(shouldDraw('p1:t1', 'p2:t2')).toBe(true)
  })

  it('does not replay the same draw, or play when a player is closed', () => {
    expect(shouldDraw('p1:t1', 'p1:t1')).toBe(false)
    expect(shouldDraw('p1:t1', null)).toBe(false)
  })
})

describe('lots', () => {
  it('uses the three auction groups, with wicketkeepers among the batsmen', () => {
    expect(lotLabel('Batter')).toBe('Batsmen')
    expect(lotLabel('Wicketkeeper')).toBe('Batsmen')
    expect(lotLabel('Bowler')).toBe('Bowlers')
    expect(lotLabel('All-rounder')).toBe('All-rounders')
    expect(inLot('Wicketkeeper', 'Batter')).toBe(true)
    expect(inLot('Bowler', 'Batter')).toBe(false)
  })

  it('reads the current lot from the drawn order', () => {
    const order = ['Bowler', 'Batter', 'All-rounder'] as const
    expect(currentLot({ lot_order: [...order], current_lot: 2 })).toBe('Batter')
    expect(currentLot({ lot_order: [...order], current_lot: null })).toBeNull()
    expect(currentLot({ lot_order: null, current_lot: 1 })).toBeNull()
  })

  it('counts who is still waiting', () => {
    const players = [
      { role: 'Batter' as const, status: 'available' as const, reauctioned: false },
      { role: 'Wicketkeeper' as const, status: 'available' as const, reauctioned: false },
      { role: 'Bowler' as const, status: 'available' as const, reauctioned: false },
      { role: 'Bowler' as const, status: 'unsold' as const, reauctioned: false },
      { role: 'Batter' as const, status: 'unsold' as const, reauctioned: true },
      { role: 'All-rounder' as const, status: 'sold' as const, reauctioned: false },
    ]
    expect(remaining(players, 'Batter')).toEqual({ inLot: 2, lots: 3, unsold: 1 })
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
