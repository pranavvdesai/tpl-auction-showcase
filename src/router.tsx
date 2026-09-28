import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react'

export function navigate(to: string, { replace = false } = {}) {
  if (to === window.location.pathname + window.location.search) return
  if (replace) window.history.replaceState({}, '', to)
  else window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function usePathname(): string {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || rest.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handleClick} {...rest} />
}
