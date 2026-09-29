import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drawKey, lotLabel, shouldDraw, splitName } from '../lib/draw'
import { roleLabel } from '../lib/format'
import type { AuctionState, Player } from '../lib/types'

/** Must match the animation length of the .draw-* keyframes in styles.css. */
export const DRAW_MS = 3200
const PREF_KEY = 'tpl-draw-animation'
/** Usable length of the bat blade, in SVG units, for the autograph. */
const BLADE_TEXT_LENGTH = 116

type Drawing = { key: string; playerId: string }

export function useDrawReveal(state: AuctionState | undefined) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(PREF_KEY) !== 'off')
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const lastKey = useRef<string | null | undefined>(undefined)

  const loaded = state !== undefined
  const key = drawKey(state)
  const playerId = state?.current_player_id ?? null

  useEffect(() => {
    if (!loaded) return
    const previous = lastKey.current
    lastKey.current = key
    if (key === previous) return
    setDrawing(enabled && shouldDraw(previous, key) && key && playerId ? { key, playerId } : null)
  }, [loaded, key, playerId, enabled])

  useEffect(() => {
    localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off')
    if (!enabled) setDrawing(null)
  }, [enabled])

  useEffect(() => {
    if (!drawing) return
    const t = window.setTimeout(() => setDrawing(null), DRAW_MS)
    return () => window.clearTimeout(t)
  }, [drawing])

  const skip = useCallback(() => setDrawing(null), [])
  const toggle = useCallback(() => setEnabled((v) => !v), [])
  const preview = useCallback((id: string) => setDrawing({ key: `preview-${Date.now()}`, playerId: id }), [])
  return { drawing, enabled, skip, toggle, preview }
}

export function DrawReveal({ player }: { player: Player }) {
  const label = lotLabel(player.role).toUpperCase()
  const lines = splitName(player.name)
  const maxSize = lines.length > 1 ? 15 : 18
  const nameRef = useRef<SVGTextElement>(null)

  useLayoutEffect(() => {
    const el = nameRef.current
    if (!el) return
    el.style.fontSize = `${maxSize}px`
    const width = el.getBBox().width
    if (width > BLADE_TEXT_LENGTH) el.style.fontSize = `${(maxSize * BLADE_TEXT_LENGTH) / width}px`
  }, [maxSize, player.name])
  return (
    <div className="draw-reveal" role="img" aria-label={`Drawing lot ${player.lot_no}: ${player.name}`}>
      <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="draw-velvet" cx="45%" cy="40%" r="75%">
            <stop offset="0%" stopColor="#b91c1c" />
            <stop offset="60%" stopColor="#7f1d1d" />
            <stop offset="100%" stopColor="#3f0a0a" />
          </radialGradient>
          <linearGradient id="draw-willow" x1="0" x2="1">
            <stop offset="0%" stopColor="#d9b577" />
            <stop offset="45%" stopColor="#f5dfae" />
            <stop offset="100%" stopColor="#caa061" />
          </linearGradient>
          <linearGradient id="draw-sleeve" x1="0" x2="1">
            <stop offset="0%" stopColor="#172554" />
            <stop offset="50%" stopColor="#1e40af" />
            <stop offset="100%" stopColor="#172554" />
          </linearGradient>
          <linearGradient id="draw-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="110">
            <stop offset="0%" stopColor="#000" />
            <stop offset="100%" stopColor="#fff" />
          </linearGradient>
          <radialGradient id="draw-glow">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
          <mask id="draw-top-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="800" height="600">
            <rect x="0" y="0" width="800" height="600" fill="url(#draw-fade)" />
          </mask>
        </defs>

        <g className="draw-bag">
          <ellipse cx="400" cy="300" rx="120" ry="26" fill="#140505" stroke="#fbbf24" strokeWidth="3" />
        </g>

        <g className="draw-bat-in">
          <Bat />
        </g>

        <g mask="url(#draw-top-fade)">
          <g className="draw-hand">
            <rect x="366" y="-320" width="68" height="646" fill="url(#draw-sleeve)" />
            <rect x="362" y="316" width="76" height="24" rx="4" fill="#fbbf24" />
            <rect x="368" y="336" width="64" height="60" rx="20" fill="#d9a066" stroke="#a86b35" strokeWidth="2" />
            <path d="M374 352 H424 M374 366 H426 M376 380 H424" stroke="#a86b35" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M368 348 Q352 360 362 378 Q370 388 382 380" fill="#d9a066" stroke="#a86b35" strokeWidth="2" />
          </g>
        </g>

        <g className="draw-bag">
          <path
            d="M280 300 A120 26 0 0 0 520 300 C548 360 572 440 548 500 Q530 548 460 550 L340 550 Q270 548 252 500 C228 440 252 360 280 300 Z"
            fill="url(#draw-velvet)"
          />
          <path d="M280 300 A120 26 0 0 0 520 300" fill="none" stroke="#fbbf24" strokeWidth="3" />
          <path d="M286 322 A116 24 0 0 0 514 322" fill="none" stroke="#d4a017" strokeWidth="9" strokeLinecap="round" />
          <path d="M300 336 q-8 40 -26 64 M500 336 q8 40 26 64" stroke="#d4a017" strokeWidth="5" fill="none" strokeLinecap="round" />
          <circle cx="274" cy="404" r="8" fill="#fbbf24" />
          <circle cx="526" cy="404" r="8" fill="#fbbf24" />
          <path d="M320 370 Q330 450 318 530 M480 370 Q470 450 482 530" stroke="#450a0a" strokeWidth="4" fill="none" opacity="0.6" />
          <rect x="305" y="410" width="190" height="60" rx="10" fill="#fbbf24" stroke="#fde68a" strokeWidth="3" />
          <text
            x="400"
            y="441"
            className="draw-bag-label"
            textAnchor="middle"
            dominantBaseline="middle"
            textLength={label.length > 8 ? 168 : undefined}
            lengthAdjust="spacingAndGlyphs"
          >
            {label}
          </text>
        </g>

        <g className="draw-glow">
          <ellipse cx="400" cy="280" rx="330" ry="120" fill="url(#draw-glow)" />
        </g>

        <g className="draw-bat-hero">
          <Bat />
          <g className="draw-autograph" transform="rotate(90 400 474)">
            <text ref={nameRef} x="400" y={lines.length > 1 ? 474 : 472} textAnchor="middle" dominantBaseline="middle" className="draw-name">
              {lines.map((line, i) => (
                <tspan key={i} x="400" dy={lines.length === 1 ? 0 : i === 0 ? '-0.55em' : '1.1em'}>
                  {line}
                </tspan>
              ))}
            </text>
            {lines.length === 1 && (
              <path d="M352 486 q16 6 32 0 t32 0 t32 0" fill="none" stroke="#1d4ed8" strokeWidth="1.4" strokeLinecap="round" />
            )}
          </g>
        </g>

        <text x="400" y="420" textAnchor="middle" className="draw-caption">
          LOT #{player.lot_no} · {roleLabel(player.role).toUpperCase()}
        </text>
      </svg>
    </div>
  )
}

function Bat() {
  return (
    <>
      <rect x="394" y="318" width="12" height="82" rx="4" fill="#1f2937" />
      {[326, 340, 354, 368, 382].map((y) => (
        <rect key={y} x="394" y={y} width="12" height="6" fill="#dc2626" />
      ))}
      <path
        d="M394 396 Q382 398 380 410 L378 522 Q378 536 400 538 Q422 536 422 522 L420 410 Q418 398 406 396 Z"
        fill="url(#draw-willow)"
        stroke="#a87a3d"
        strokeWidth="1.5"
      />
    </>
  )
}
