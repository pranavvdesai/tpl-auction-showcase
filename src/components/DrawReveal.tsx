import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { WHEEL_ANGLES, drawKey, landingAngle, lotLabel, lotOrderKey, shouldDraw, splitName } from '../lib/draw'
import { roleLabel } from '../lib/format'
import type { AuctionState, Lot, Player } from '../lib/types'

/** Must match the .draw-* keyframes in styles.css. */
export const DRAW_MS = 4200
/** Arrow lot draw timeline, in ms from the moment the reveal mounts. */
const SPIN_1_MS = 4800
const SPIN_2_MS = 3800
const LAND_HOLD_MS = 1600
const SPIN_1_START = 150
const SPIN_2_START = SPIN_1_START + SPIN_1_MS + LAND_HOLD_MS
const FINAL_AT = SPIN_2_START + SPIN_2_MS + LAND_HOLD_MS
export const LOT_ORDER_MS = FINAL_AT + 2600
/** Usable length of the bat blade, in SVG units, for the autograph. */
const BLADE_TEXT_LENGTH = 116

function useOneShot(key: string | null, loaded: boolean, duration: number) {
  const [active, setActive] = useState<string | null>(null)
  const lastKey = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!loaded) return
    const previous = lastKey.current
    lastKey.current = key
    if (key === previous) return
    setActive(shouldDraw(previous, key) ? key : null)
  }, [loaded, key])

  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => setActive(null), duration)
    return () => window.clearTimeout(t)
  }, [active, duration])

  const skip = useCallback(() => setActive(null), [])
  return { active, skip }
}

export function useReveals(state: AuctionState | undefined) {
  const loaded = state !== undefined
  const player = useOneShot(drawKey(state), loaded, DRAW_MS)
  const lotOrder = useOneShot(lotOrderKey(state), loaded, LOT_ORDER_MS)
  const { skip: skipPlayer } = player
  const { skip: skipLotOrder } = lotOrder
  const skip = useCallback(() => {
    skipPlayer()
    skipLotOrder()
  }, [skipPlayer, skipLotOrder])
  return { playerDraw: player.active, lotOrderDraw: lotOrder.active, skip }
}

export function DrawReveal({ player }: { player: Player }) {
  const label = lotLabel(player.role).toUpperCase()
  const lines = splitName(player.name)
  const maxSize = lines.length > 1 ? 15 : 18
  const nameRef = useRef<SVGTextElement>(null)

  useEffect(() => {
    if (player.photo_url) new Image().src = player.photo_url
  }, [player.photo_url])

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
        <SceneDefs />

        <g className="draw-bag">
          <BagBack />
        </g>

        <g className="draw-bat-in">
          <Bat />
        </g>

        <g mask="url(#draw-top-fade)">
          <g className="draw-hand">
            <Hand />
          </g>
        </g>

        <g className="draw-bag">
          <BagFront label={label} />
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

const ORDINALS = ['1ST', '2ND', '3RD']
/** Fixed wheel layout, so the wheel itself gives nothing away about the order. */
const WHEEL: Array<{ lot: Lot; angle: number; color: string }> = [
  { lot: 'Batter', angle: WHEEL_ANGLES.Batter, color: '#1d4ed8' },
  { lot: 'Bowler', angle: WHEEL_ANGLES.Bowler, color: '#b91c1c' },
  { lot: 'All-rounder', angle: WHEEL_ANGLES['All-rounder'], color: '#15803d' },
]
const CX = 400
const CY = 262
const R = 196
const SLOT_X = [170, 400, 630]

function polar(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180
  return { x: CX + radius * Math.sin(rad), y: CY - radius * Math.cos(rad) }
}

function sectorPath(center: number) {
  const a = polar(center - 60, R)
  const b = polar(center + 60, R)
  return `M${CX} ${CY} L${a.x} ${a.y} A${R} ${R} 0 0 1 ${b.x} ${b.y} Z`
}

type Step = 'idle' | 'spin1' | 'land1' | 'spin2' | 'land2' | 'final'

export function LotOrderReveal({ order }: { order: Lot[] }) {
  const [step, setStep] = useState<Step>('idle')
  const [angles] = useState(() => {
    const first = landingAngle(0, order[0], 6)
    return { first, second: landingAngle(first, order[1], 5) }
  })

  useEffect(() => {
    const at = (ms: number, next: Step) => window.setTimeout(() => setStep(next), ms)
    const timers = [
      at(SPIN_1_START, 'spin1'),
      at(SPIN_1_START + SPIN_1_MS, 'land1'),
      at(SPIN_2_START, 'spin2'),
      at(SPIN_2_START + SPIN_2_MS, 'land2'),
      at(FINAL_AT, 'final'),
    ]
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])

  const steps: Step[] = ['idle', 'spin1', 'land1', 'spin2', 'land2', 'final']
  const reached = (s: Step) => steps.indexOf(step) >= steps.indexOf(s)
  const revealed = reached('final') ? 3 : reached('land2') ? 2 : reached('land1') ? 1 : 0
  const rotation = reached('spin2') ? angles.second : reached('spin1') ? angles.first : 0
  const spinMs = step === 'spin1' ? SPIN_1_MS : step === 'spin2' ? SPIN_2_MS : 0
  const justLanded = step === 'land1' ? order[0] : step === 'land2' ? order[1] : step === 'final' ? order[2] : null

  return (
    <div className="lot-reveal" role="img" aria-label={`Drawing the lot order: ${order.map((l) => lotLabel(l)).join(', ')}`}>
      <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="wheel-shine" cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <filter id="arrow-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000" floodOpacity="0.55" />
          </filter>
        </defs>

        <text x="400" y="34" textAnchor="middle" className="lot-reveal-title">
          {step === 'final' ? 'THE LOT ORDER' : 'DRAWING THE LOT ORDER'}
        </text>

        <circle cx={CX} cy={CY} r={R + 14} className="wheel-rim" />
        {WHEEL.map((w) => {
          const n = order.indexOf(w.lot) + 1
          const taken = n > 0 && n <= revealed
          const label = polar(w.angle, R * 0.6)
          return (
            <g key={w.lot} className={`wheel-sector ${taken ? 'taken' : ''} ${justLanded === w.lot ? 'won' : ''}`}>
              <path d={sectorPath(w.angle)} fill={w.color} />
              <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" className="wheel-label">
                {lotLabel(w.lot).toUpperCase()}
              </text>
              {taken && (
                <text x={label.x} y={label.y + 34} textAnchor="middle" dominantBaseline="middle" className="wheel-badge">
                  {ORDINALS[n - 1]} LOT
                </text>
              )}
            </g>
          )
        })}
        <circle cx={CX} cy={CY} r={R} fill="url(#wheel-shine)" pointerEvents="none" />
        {WHEEL.map((w) => {
          const p = polar(w.angle + 60, R + 7)
          return <circle key={`peg-${w.lot}`} cx={p.x} cy={p.y} r="7" className="wheel-peg" />
        })}

        <g
          className="wheel-arrow"
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: `${CX}px ${CY}px`,
            transition: spinMs ? `transform ${spinMs}ms cubic-bezier(0.12, 0.72, 0.18, 1)` : 'none',
          }}
          filter="url(#arrow-shadow)"
        >
          <path d={`M${CX} ${CY - R + 18} L${CX + 22} ${CY - R + 66} L${CX + 9} ${CY - R + 66} L${CX + 9} ${CY + 28} L${CX - 9} ${CY + 28} L${CX - 9} ${CY - R + 66} L${CX - 22} ${CY - R + 66} Z`} />
        </g>
        <circle cx={CX} cy={CY} r="26" className="wheel-hub" />
        <circle cx={CX} cy={CY} r="9" className="wheel-hub-dot" />

        {SLOT_X.map((x, i) => {
          const lot = i < revealed ? order[i] : null
          return (
            <g key={x} className={`lot-slot-group ${lot ? 'filled' : ''}`}>
              <rect x={x - 105} y="498" width="210" height="64" rx="12" className="lot-slot" />
              <text x={x} y="531" textAnchor="middle" dominantBaseline="middle" className={lot ? 'lot-slot-name' : 'lot-slot-q'}>
                {lot ? lotLabel(lot).toUpperCase() : '?'}
              </text>
              <text x={x} y="584" textAnchor="middle" className="lot-slot-label">
                {ORDINALS[i]} LOT
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function SceneDefs() {
  return (
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
  )
}

/** The inside of the bag's mouth, drawn behind the hand. */
function BagBack() {
  return <ellipse cx="400" cy="300" rx="120" ry="26" fill="#140505" stroke="#fbbf24" strokeWidth="3" />
}

/** The body of the bag, drawn in front of the hand so it looks like the hand is inside. */
function BagFront({ label }: { label: string }) {
  return (
    <>
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
    </>
  )
}

function Hand() {
  return (
    <>
      <rect x="366" y="-320" width="68" height="646" fill="url(#draw-sleeve)" />
      <rect x="362" y="316" width="76" height="24" rx="4" fill="#fbbf24" />
      <rect x="368" y="336" width="64" height="60" rx="20" fill="#d9a066" stroke="#a86b35" strokeWidth="2" />
      <path d="M374 352 H424 M374 366 H426 M376 380 H424" stroke="#a86b35" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M368 348 Q352 360 362 378 Q370 388 382 380" fill="#d9a066" stroke="#a86b35" strokeWidth="2" />
    </>
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

