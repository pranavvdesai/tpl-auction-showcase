import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuctionState } from './types'

const STORAGE_KEY = 'tpl-sale-sound'
const MUSIC_SRC = '/sounds/sold-music.mp3'
/** The track opens with a quiet build; the beat drops at 2.0 s. */
const MUSIC_START_S = 1.9
const MUSIC_MAX_MS = 20_000
const FADE_MS = 1200

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

type Music = { audio: HTMLAudioElement; fade?: number; cutoff?: number }

function clearTimers(m: Music) {
  window.clearInterval(m.fade)
  window.clearTimeout(m.cutoff)
}

function fadeOut(m: Music | null) {
  if (!m || m.audio.paused) return
  clearTimers(m)
  const { audio } = m
  const step = audio.volume / (FADE_MS / 50)
  m.fade = window.setInterval(() => {
    audio.volume = Math.max(0, audio.volume - step)
    if (audio.volume === 0) {
      window.clearInterval(m.fade)
      audio.pause()
    }
  }, 50)
}

function playMusic(m: Music | null) {
  if (!m) return
  clearTimers(m)
  m.audio.volume = 1
  m.audio.currentTime = MUSIC_START_S
  void m.audio.play().catch(() => {})
  m.cutoff = window.setTimeout(() => fadeOut(m), MUSIC_MAX_MS)
}

function hasUserActivation(): boolean {
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
  return nav.userActivation?.hasBeenActive ?? false
}

export function useSaleSound(state: AuctionState | undefined) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) !== 'off')
  const [unlocked, setUnlocked] = useState(hasUserActivation)
  const music = useRef<Music | null>(null)
  const lastKey = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const audio = new Audio(MUSIC_SRC)
    audio.preload = 'auto'
    const m: Music = { audio }
    music.current = m
    return () => {
      clearTimers(m)
      audio.pause()
      music.current = null
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
    if (!enabled) fadeOut(music.current)
  }, [enabled])

  const loaded = state !== undefined
  const key = saleKey(state)
  useEffect(() => {
    if (!loaded) return
    const action = saleSoundAction(lastKey.current, key)
    lastKey.current = key
    if (action === 'stop') fadeOut(music.current)
    if (action === 'play' && enabled) playMusic(music.current)
  }, [loaded, key, enabled])

  const toggle = useCallback(() => setEnabled((v) => !v), [])
  return { enabled, unlocked, toggle }
}
