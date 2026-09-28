import type { Category } from '../lib/types'

export function CategoryTag({ category }: { category: Category }) {
  return <span className={`cat cat-${category}`}>{category === 'Marquee' ? 'Marquee' : `Set ${category}`}</span>
}
