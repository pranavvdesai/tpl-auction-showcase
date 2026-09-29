import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuctionState } from './types'

const STORAGE_KEY = 'tpl-sale-sound'
const CHEER_DELAY_MS = 300

type SaleState = Pick<AuctionState, 'status' | 'current_player_id' | 'updated_at'>

export function saleKey(state: SaleState | null | undefined): string | null {
  if (!state || state.status !== 'sold' || !state.current_player_id) return null
  return `${state.current_player_id}:${state.updated_at}`
}

/** `previous` is undefined until the first state has been seen, so a sale already on screen at page load stays silent. */
export function saleSoundAction(previous: string | null | undefined, next: string | null): 'play' | 'stop' | 'none' {
  if (previous === undefined || previous === next) return 'none'
  return next ? 'play' : 'stop'
}

type Sounds = { gavel: HTMLAudioElement; cheer: HTMLAudioElement; timer?: number }

function stopSounds(s: Sounds | null) {
  if (!s) return
  window.clearTimeout(s.timer)
  for (const a of [s.gavel, s.cheer]) {
    a.pause()
    a.currentTime = 0
  }
}

function playSounds(s: Sounds | null) {
  if (!s) return
  stopSounds(s)
  void s.gavel.play().catch(() => {})
  s.timer = window.setTimeout(() => void s.cheer.play().catch(() => {}), CHEER_DELAY_MS)
}

function hasUserActivation(): boolean {
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
  return nav.userActivation?.hasBeenActive ?? false
}

export function useSaleSound(state: AuctionState | undefined) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) !== 'off')
  const [unlocked, setUnlocked] = useState(hasUserActivation)
  const sounds = useRef<Sounds | null>(null)
  const lastKey = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const gavel = new Audio('/sounds/gavel.mp3')
    const cheer = new Audio('/sounds/cheer.mp3')
    gavel.preload = cheer.preload = 'auto'
    cheer.volume = 0.85
    sounds.current = { gavel, cheer }
    return () => {
      stopSounds(sounds.current)
      sounds.current = null
    }
  }, [])

  useEffect(() => {
    if (unlocked) return
    const unlock = () => setUnlocked(true)
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [unlocked])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
    if (!enabled) stopSounds(sounds.current)
  }, [enabled])

  const loaded = state !== undefined
  const key = saleKey(state)
  useEffect(() => {
    if (!loaded) return
    const action = saleSoundAction(lastKey.current, key)
    lastKey.current = key
    if (action === 'stop') stopSounds(sounds.current)
    if (action === 'play' && enabled) playSounds(sounds.current)
  }, [loaded, key, enabled])

  const toggle = useCallback(() => setEnabled((v) => !v), [])
  return { enabled, unlocked, toggle }
}
