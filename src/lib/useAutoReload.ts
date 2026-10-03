import { useEffect, useState } from 'react'

const CHECK_MS = 30000

function bundleSrc(): string | null {
  return document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src') ?? null
}

function isTyping(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
}

/** Reloads a long-open screen once a new version is deployed, waiting until `canReload` and nobody is typing. */
export function useAutoReload(canReload = true) {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    const mine = bundleSrc()
    if (!mine) return
    const check = async () => {
      try {
        const res = await fetch('/', { cache: 'no-store' })
        if (res.ok && !(await res.text()).includes(mine)) setStale(true)
      } catch {
        // Offline for a moment; try again on the next tick.
      }
    }
    const timer = window.setInterval(() => void check(), CHECK_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!stale || !canReload) return
    const tryReload = () => {
      if (!isTyping()) window.location.reload()
    }
    tryReload()
    const timer = window.setInterval(tryReload, 2000)
    return () => window.clearInterval(timer)
  }, [stale, canReload])
}
