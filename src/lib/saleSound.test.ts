import { describe, expect, it } from 'vitest'
import { saleKey, saleSoundAction } from './saleSound'

const at = '2026-09-29T10:00:00Z'

describe('saleKey', () => {
  it('is only set while a player is shown as sold', () => {
    expect(saleKey({ status: 'sold', current_player_id: 'p1', updated_at: at })).toBe(`p1:${at}`)
    expect(saleKey({ status: 'live', current_player_id: 'p1', updated_at: at })).toBeNull()
    expect(saleKey({ status: 'unsold', current_player_id: 'p1', updated_at: at })).toBeNull()
    expect(saleKey({ status: 'idle', current_player_id: null, updated_at: at })).toBeNull()
    expect(saleKey(undefined)).toBeNull()
  })
})

describe('saleSoundAction', () => {
  it('stays silent for a sale already on screen when the page opens or refreshes', () => {
    expect(saleSoundAction(undefined, 'p1:t1')).toBe('none')
    expect(saleSoundAction(undefined, null)).toBe('none')
  })

  it('plays when a new sale happens', () => {
    expect(saleSoundAction(null, 'p1:t1')).toBe('play')
    expect(saleSoundAction('p1:t1', 'p2:t2')).toBe('play')
  })

  it('does not replay for the same sale', () => {
    expect(saleSoundAction('p1:t1', 'p1:t1')).toBe('none')
  })

  it('stops when the sale is undone or the next lot starts, and ignores unsold', () => {
    expect(saleSoundAction('p1:t1', null)).toBe('stop')
    expect(saleSoundAction(null, null)).toBe('none')
  })
})
