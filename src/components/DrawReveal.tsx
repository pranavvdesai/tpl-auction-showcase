import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drawKey, lotLabel, lotOrderKey, shouldDraw, splitName } from '../lib/draw'
import { roleLabel } from '../lib/format'
import type { AuctionState, Lot, Player } from '../lib/types'

/** Must match the .draw-* keyframes in styles.css. */
export const DRAW_MS = 3200
/** Must match the .lot-* keyframes in styles.css: three 2 s draws after a 0.3 s lead-in, then a short hold. */
export const LOT_ORDER_MS = 7200
/** Usable length of the bat blade, in SVG units, for the autograph. */
const BLADE_TEXT_LENGTH = 116
const SLOT_X = [150, 400, 650]
const SLOT_Y = 528
const TICKET_Y = 410

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
const BAG_SCALE = 'translate(400 300) scale(0.8) translate(-400 -300)'

export function LotOrderReveal({ order }: { order: Lot[] }) {
  return (
    <div className="lot-reveal" role="img" aria-label={`Drawing the lot order: ${order.map((l) => lotLabel(l)).join(', ')}`}>
      <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet">
        <SceneDefs />

        <text x="400" y="44" textAnchor="middle" className="lot-reveal-title">
          DRAWING THE LOT ORDER
        </text>
        {SLOT_X.map((x, i) => (
          <g key={x}>
            <rect x={x - 100} y={SLOT_Y - 36} width="200" height="72" rx="12" className="lot-slot" />
            <text x={x} y="592" textAnchor="middle" className="lot-slot-label">
              {ORDINALS[i]} LOT
            </text>
          </g>
        ))}

        <g className="lot-bag-fade">
          <g transform={BAG_SCALE}>
            <g className="lot-bag-wobble">
              <BagBack />
            </g>
          </g>
        </g>

        {order.map((lot, i) => (
          <g key={`in-${lot}`} className="lot-ticket-in" style={{ animationDelay: `${0.3 + 2 * i}s` }}>
            <Ticket text={lotLabel(lot).toUpperCase()} />
          </g>
        ))}

        <g mask="url(#draw-top-fade)">
          <g className="lot-hand">
            <Hand />
          </g>
        </g>

        <g className="lot-bag-fade">
          <g transform={BAG_SCALE}>
            <g className="lot-bag-wobble">
              <BagFront label="LOTS" />
            </g>
          </g>
        </g>

        {order.map((lot, i) => (
          <g
            key={`out-${lot}`}
            className="lot-ticket-hero"
            style={{
              animationDelay: `${0.3 + 2 * i}s`,
              ['--tx' as string]: `${SLOT_X[i] - 400}px`,
              ['--ty' as string]: `${SLOT_Y - TICKET_Y}px`,
            }}
          >
            <Ticket text={lotLabel(lot).toUpperCase()} />
          </g>
        ))}
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

function Ticket({ text }: { text: string }) {
  return (
    <>
      <rect x="310" y={TICKET_Y - 28} width="180" height="56" rx="8" fill="#fbbf24" stroke="#fde68a" strokeWidth="3" />
      <rect x="318" y={TICKET_Y - 20} width="164" height="40" rx="5" fill="none" stroke="#b45309" strokeWidth="1.5" strokeDasharray="4 3" />
      <text
        x="400"
        y={TICKET_Y + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        className="lot-ticket-text"
        textLength={text.length > 8 ? 146 : undefined}
        lengthAdjust="spacingAndGlyphs"
      >
        {text}
      </text>
    </>
  )
}
