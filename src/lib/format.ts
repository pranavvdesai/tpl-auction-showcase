const numberFormat = new Intl.NumberFormat('en-IN')

export function pts(value: number | null | undefined): string {
  return value == null ? '—' : numberFormat.format(value)
}
