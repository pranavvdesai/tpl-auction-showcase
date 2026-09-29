import type { Category } from '../lib/types'

export function CategoryTag({ category }: { category: Category | null }) {
  if (!category) return null
  return <span className={`cat cat-${category}`}>{category === 'Marquee' ? 'Marquee' : `Set ${category}`}</span>
}
