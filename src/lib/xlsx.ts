// Minimal .xlsx reader for Microsoft Forms exports. Forms writes a wrong
// <dimension ref="A1"> and prefixes every tag with "x:", which trips up common
// readers, so cells are read directly from the sheet XML instead.
import JSZip from 'jszip'

export type Cell = string | number | boolean | null

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : match
    }
    return ENTITIES[code] ?? match
  })
}

function textRuns(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += m[1]
  return decodeXml(out)
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

async function firstSheetPath(zip: JSZip): Promise<string> {
  const workbook = await zip.file('xl/workbook.xml')?.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  const rid = workbook?.match(/<(?:\w+:)?sheet\s[^>]*r:id="([^"]+)"/)?.[1]
  if (rid && rels) {
    const rel = [...rels.matchAll(/<(?:\w+:)?Relationship\s([^>]*)\/?>/g)].map((m) => m[1]).find((a) => a.includes(`Id="${rid}"`))
    const target = rel?.match(/Target="([^"]+)"/)?.[1]
    if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  }
  const fallback = Object.keys(zip.files).find((n) => /^xl\/worksheets\/sheet\d*\.xml$/.test(n))
  if (!fallback) throw new Error('This file has no worksheet. Is it an Excel (.xlsx) file?')
  return fallback
}

export async function readXlsxRows(data: ArrayBuffer | Uint8Array | Blob): Promise<Cell[][]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('Could not open this file. Please upload the .xlsx file downloaded from Microsoft Forms.')
  }

  const sharedXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? ''
  const shared = [...sharedXml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textRuns(m[1]))

  const sheetXml = await zip.file(await firstSheetPath(zip))?.async('string')
  if (!sheetXml) throw new Error('Could not read the first worksheet.')

  const rows: Cell[][] = []
  for (const rowMatch of sheetXml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1)
    const row: Cell[] = []
    let nextCol = 0
    for (const cellMatch of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cellMatch[1]
      const body = cellMatch[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1]
      const col = ref ? columnIndex(ref) : nextCol
      nextCol = col + 1
      const type = attrs.match(/\bt="(\w+)"/)?.[1]
      const raw = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1]
      let value: Cell = null
      if (type === 's' && raw != null) value = shared[Number(raw)] ?? null
      else if (type === 'inlineStr') value = textRuns(body)
      else if (type === 'str' && raw != null) value = decodeXml(raw)
      else if (type === 'b' && raw != null) value = raw === '1'
      else if (raw != null) value = Number.isNaN(Number(raw)) ? decodeXml(raw) : Number(raw)
      row[col] = value
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null
    rows[rowNumber - 1] = row
  }
  return Array.from(rows, (r) => r ?? [])
}
