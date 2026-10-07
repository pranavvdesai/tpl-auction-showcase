import { useLayoutEffect, useRef } from 'react'

/** One line of text that shrinks from its CSS font size until it fits the width of its box. */
export function FitText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.fontSize = ''
      const room = el.clientWidth
      const needed = el.scrollWidth
      if (needed > room && room > 0) {
        const size = parseFloat(getComputedStyle(el).fontSize)
        el.style.fontSize = `${Math.floor(((size * room) / needed) * 0.97 * 10) / 10}px`
      }
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el.parentElement ?? el)
    void document.fonts?.ready.then(fit)
    return () => observer.disconnect()
  }, [text])

  return (
    <div ref={ref} className={`fit-text ${className ?? ''}`}>
      {text}
    </div>
  )
}
