import { useState, type CSSProperties } from 'react'
import { DEMO_PASSWORD, DEMO_USERNAME, fastForwardToRoundTwo, resetDemo } from './db'

const bar: CSSProperties = {
  position: 'fixed',
  left: 12,
  bottom: 12,
  zIndex: 9999,
  maxWidth: 'min(560px, calc(100vw - 24px))',
  background: '#fff8db',
  color: '#3d2f05',
  border: '1px solid #e7c75f',
  borderRadius: 12,
  boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
  padding: '10px 12px',
  font: '13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif',
}

const btn: CSSProperties = {
  font: 'inherit',
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 8,
  border: '1px solid #c9a227',
  background: '#fff',
  color: '#3d2f05',
  cursor: 'pointer',
}

export function DemoBanner() {
  const onProjection = window.location.pathname.startsWith('/projection')
  const [open, setOpen] = useState(!onProjection)
  const [note, setNote] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" style={{ ...bar, padding: '6px 12px', cursor: 'pointer', fontWeight: 700 }} onClick={() => setOpen(true)}>
        DEMO · synthetic data
      </button>
    )
  }

  return (
    <aside style={bar} aria-label="Demo information">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>Demo build of the real TPL Auction app</strong>
        <button type="button" style={{ ...btn, padding: '0 8px' }} onClick={() => setOpen(false)} aria-label="Minimise demo panel">
          –
        </button>
      </div>
      <p style={{ margin: '4px 0 8px' }}>
        Same screens, rules and animations as production. Teams and players are fictional, and the database runs inside your
        browser instead of Supabase, so nothing is shared or saved online. Operator login: <code>{DEMO_USERNAME}</code> /{' '}
        <code>{DEMO_PASSWORD}</code>. Open <a href="/operator">/operator</a> and{' '}
        <a href="/projection" target="_blank" rel="noreferrer">
          /projection
        </a>{' '}
        in two tabs to see them stay in sync.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button type="button" style={btn} onClick={() => setNote(fastForwardToRoundTwo())}>
          Fast-forward to round 2
        </button>
        <button
          type="button"
          style={btn}
          onClick={() => {
            resetDemo()
            setNote('Demo data reset.')
          }}
        >
          Reset demo data
        </button>
      </div>
      {note && <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{note}</p>}
    </aside>
  )
}
