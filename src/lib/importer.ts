// Turns a Microsoft Forms registration export into auction players.
// Contact columns (phone, email) are never read beyond the header.
import type { Cell } from './xlsx'
import type { Role } from './types'

export type FieldKey =
  | 'name'
  | 'roll_no'
  | 'role'
  | 'batting'
  | 'bowling_hand'
  | 'bowling_type'
  | 'wicketkeeping'
  | 'photo'
  | 'submitted_at'

export type ColumnMap = Record<FieldKey, number | null>

export const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'Player name',
  roll_no: 'Roll number',
  role: 'Primary role',
  batting: 'Batting hand',
  bowling_hand: 'Bowling hand',
  bowling_type: 'Bowling type',
  wicketkeeping: 'Wicketkeeping',
  photo: 'Photo (file upload)',
  submitted_at: 'Submission time',
}

export const REQUIRED_FIELDS: FieldKey[] = ['name', 'roll_no', 'role']

// Columns Microsoft Forms adds to every export; "Name"/"Email" are the respondent's account.
const FORMS_METADATA = ['ID', 'Start time', 'Completion time', 'Email', 'Name', 'Last modified time']

const DETECTORS: Array<[FieldKey, (h: string) => boolean]> = [
  ['submitted_at', (h) => h === 'COMPLETION TIME'],
  ['photo', (h) => /PHOTO|PICTURE|IMAGE|SELFIE|\bPIC\b/.test(h)],
  ['roll_no', (h) => /ROLL|REG(ISTRATION)? ?NO/.test(h)],
  ['wicketkeeping', (h) => /WICKET ?KEEP|KEEPING|\bWK\b/.test(h)],
  ['bowling_hand', (h) => /BOWL/.test(h) && /HAND|ARM/.test(h)],
  ['bowling_type', (h) => /BOWL/.test(h) && /TYPE|STYLE|KIND/.test(h)],
  ['batting', (h) => /BAT/.test(h)],
  ['role', (h) => /ROLE|SPECIALI[SZ]/.test(h)],
  ['name', (h) => /\bNAME\b/.test(h)],
]

function normalizeHeader(h: Cell): string {
  return String(h ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

export function detectColumns(headers: Cell[]): ColumnMap {
  const map = Object.fromEntries(Object.keys(FIELD_LABELS).map((k) => [k, null])) as ColumnMap
  const used = new Set<number>()
  headers.forEach((raw, index) => {
    const original = String(raw ?? '').trim()
    const h = normalizeHeader(raw)
    const isMetadata = FORMS_METADATA.includes(original)
    for (const [field, test] of DETECTORS) {
      if (map[field] != null || used.has(index)) continue
      if (isMetadata && field !== 'submitted_at') continue
      if (test(h)) {
        map[field] = index
        used.add(index)
      }
    }
  })
  return map
}

export type IssueLevel = 'error' | 'warning'
export interface Issue {
  level: IssueLevel
  text: string
}

export interface ParsedPlayer {
  rowNumber: number
  name: string
  roll_no: string
  batch: string | null
  role: Role | null
  batting_style: string | null
  bowling_style: string | null
  is_wicketkeeper: boolean
  photo_file: string | null
  submittedAt: number
  issues: Issue[]
}

const clean = (v: Cell): string => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

export function titleCase(name: string): string {
  return clean(name)
    .toLowerCase()
    .replace(/(^|[\s.'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

export function mapRole(value: Cell): Role | null {
  const v = clean(value).toUpperCase().replace(/[^A-Z]/g, '')
  if (!v) return null
  if (v.includes('ALLROUND')) return 'All-rounder'
  if (v.includes('WICKET') || v === 'WK' || v.includes('KEEPER')) return 'Wicketkeeper'
  if (v.includes('BATS') || v.includes('BATTER')) return 'Batter'
  if (v.includes('BOWL')) return 'Bowler'
  return null
}

function hand(value: Cell): 'Right' | 'Left' | null {
  const v = clean(value).toUpperCase()
  if (v.includes('LEFT')) return 'Left'
  if (v.includes('RIGHT')) return 'Right'
  return null
}

export function mapBowling(handValue: Cell, typeValue: Cell): string | null {
  const t = clean(typeValue).toUpperCase()
  if (!t || /NONE|DON.?T|NOT|^NO$|^NA$/.test(t)) return null
  const style = /OFF/.test(t)
    ? 'off-spin'
    : /LEG|WRIST|CHINA/.test(t)
      ? 'leg-spin'
      : /SPIN/.test(t)
        ? 'spin'
        : /MED/.test(t)
          ? 'medium pace'
          : /PACE|FAST|SEAM/.test(t)
            ? 'pace'
            : clean(typeValue).toLowerCase()
  const h = hand(handValue)
  return h ? `${h}-arm ${style}` : style.charAt(0).toUpperCase() + style.slice(1)
}

export function photoFileFromLink(value: Cell): string | null {
  const link = clean(value).split(/;\s*/)[0]
  if (!link) return null
  const last = link.split('?')[0].split('/').pop() ?? ''
  try {
    return decodeURIComponent(last) || null
  } catch {
    return last || null
  }
}

// The roll number starts with the intake year: 2025 intake is MBA 2, 2024 intake is MBA 1.
// Keep in sync with supabase/migrations/20260929160000_mba_year.sql.
const MBA_BY_INTAKE: Record<string, string> = { '25': 'MBA 2', '24': 'MBA 1' }

export function mbaYear(rollNo: string): string | null {
  return MBA_BY_INTAKE[rollNo.slice(0, 2)] ?? null
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i
const ROLL_PATTERN = /^\d{2}[A-Z]{1,3}\d{1,4}$/

export function normalizeRow(cells: Cell[], map: ColumnMap, rowNumber: number): ParsedPlayer {
  const get = (f: FieldKey) => (map[f] == null ? null : (cells[map[f] as number] ?? null))
  const issues: Issue[] = []

  const name = titleCase(clean(get('name')))
  const roll_no = clean(get('roll_no')).toUpperCase().replace(/\s+/g, '')
  const role = mapRole(get('role'))
  const photo_file = photoFileFromLink(get('photo'))
  const wk = clean(get('wicketkeeping')).toUpperCase()
  const submittedRaw = get('submitted_at')

  if (!name) issues.push({ level: 'error', text: 'Name is missing' })
  if (!roll_no) issues.push({ level: 'error', text: 'Roll number is missing' })
  else if (!ROLL_PATTERN.test(roll_no)) issues.push({ level: 'warning', text: `Roll number “${roll_no}” looks unusual` })
  if (!role) issues.push({ level: 'error', text: `Unrecognised role “${clean(get('role'))}”` })
  if (!photo_file) issues.push({ level: 'warning', text: 'No photo uploaded in the form' })
  else if (/\.hei[cf]$/i.test(photo_file)) issues.push({ level: 'warning', text: 'Photo is an iPhone HEIC file; ask for a JPG' })
  else if (!IMAGE_EXT.test(photo_file)) issues.push({ level: 'warning', text: 'Uploaded photo is not an image file' })

  return {
    rowNumber,
    name,
    roll_no,
    batch: mbaYear(roll_no),
    role,
    batting_style: hand(get('batting')) ? `${hand(get('batting'))}-hand bat` : null,
    bowling_style: mapBowling(get('bowling_hand'), get('bowling_type')),
    is_wicketkeeper: role === 'Wicketkeeper' || wk === 'YES' || wk === 'Y',
    photo_file,
    submittedAt: typeof submittedRaw === 'number' ? submittedRaw : Date.parse(String(submittedRaw ?? '')) || rowNumber,
    issues,
  }
}

export interface ParsedSheet {
  headers: string[]
  map: ColumnMap
  players: ParsedPlayer[]
  totalRows: number
  duplicatesRemoved: number
}

export function parseRegistrationRows(rows: Cell[][], map?: ColumnMap): ParsedSheet {
  const headerIndex = rows.findIndex((r) => r.some((c) => clean(c) !== ''))
  if (headerIndex < 0) throw new Error('The sheet is empty.')
  const headers = rows[headerIndex].map((h) => clean(h))
  const columns = map ?? detectColumns(rows[headerIndex])
  const body = rows.slice(headerIndex + 1).filter((r) => r.some((c) => clean(c) !== ''))
  const parsed = body.map((cells, i) => normalizeRow(cells, columns, headerIndex + i + 2))
  const { players, duplicatesRemoved } = dedupeByRoll(parsed)
  return { headers, map: columns, players, totalRows: body.length, duplicatesRemoved }
}

export function dedupeByRoll(players: ParsedPlayer[]): { players: ParsedPlayer[]; duplicatesRemoved: number } {
  const latest = new Map<string, ParsedPlayer>()
  const withoutRoll: ParsedPlayer[] = []
  for (const p of players) {
    if (!p.roll_no) {
      withoutRoll.push(p)
      continue
    }
    const existing = latest.get(p.roll_no)
    if (!existing || p.submittedAt >= existing.submittedAt) latest.set(p.roll_no, p)
  }
  const kept = [...latest.values(), ...withoutRoll].sort((a, b) => a.rowNumber - b.rowNumber)
  for (const p of kept) {
    const count = players.filter((x) => x.roll_no && x.roll_no === p.roll_no).length
    if (count > 1) p.issues.push({ level: 'warning', text: `Registered ${count} times; using the latest response` })
  }
  return { players: kept, duplicatesRemoved: players.length - kept.length }
}

const looseKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9.]/g, '')

// Matches by the file name in the form's photo link, or by a file named after the roll number
// (e.g. "25F101.jpg" or "25F101 - Asha.png") for photos collected outside the form.
export function matchPhotos(
  wanted: Array<{ roll_no: string; photo_file: string | null }>,
  available: string[],
): { matches: Map<string, string>; unusedFiles: string[] } {
  const byExact = new Map<string, string>()
  const byLoose = new Map<string, string>()
  const byRoll = new Map<string, string>()
  for (const path of available) {
    const base = path.split('/').pop() ?? path
    byExact.set(base, path)
    byLoose.set(looseKey(base), path)
    for (const token of base.replace(/\.[^.]+$/, '').toUpperCase().split(/[^A-Z0-9]+/)) {
      if (token && !byRoll.has(token)) byRoll.set(token, path)
    }
  }
  const matches = new Map<string, string>()
  for (const p of wanted) {
    const hit =
      (p.photo_file ? (byExact.get(p.photo_file) ?? byLoose.get(looseKey(p.photo_file))) : undefined) ??
      byRoll.get(p.roll_no.toUpperCase())
    if (hit) matches.set(p.roll_no, hit)
  }
  const used = new Set(matches.values())
  return { matches, unusedFiles: available.filter((f) => !used.has(f)) }
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXT.test(name)
}
