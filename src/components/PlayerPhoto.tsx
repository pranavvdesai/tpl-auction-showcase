import { useEffect, useState } from 'react'

interface Props {
  name: string
  src: string | null | undefined
  className?: string
  eager?: boolean
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function PlayerPhoto({ name, src, className = '', eager = false }: Props) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  if (!src || failed) {
    return (
      <span className={`avatar avatar-fallback ${className}`} aria-label={name}>
        {initials(name)}
      </span>
    )
  }
  return (
    <img
      className={`avatar ${className}`}
      src={src}
      alt={name}
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
    />
  )
}
