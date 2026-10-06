import JSZip from 'jszip'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Brand } from '../components/Brand'
import { OperatorGate } from '../components/OperatorGate'
import { initials } from '../components/PlayerPhoto'
import { PoolTable } from '../components/PoolTable'
import {
  FIELD_LABELS,
  REQUIRED_FIELDS,
  isImageFile,
  matchPhotos,
  parseRegistrationRows,
  type ColumnMap,
  type FieldKey,
  type ParsedPlayer,
} from '../lib/importer'
import { roleLabel } from '../lib/format'
import { photoPath, preparePhoto } from '../lib/photos'
import { errorMessage, supabase } from '../lib/supabase'
import { useAuction } from '../lib/useAuction'
import { readXlsxRows, type Cell } from '../lib/xlsx'
import { Link } from '../router'

type PhotoSource = { path: string; load: () => Promise<Blob> }
type Prepared = { blob: Blob; url: string } | { error: string }
type Target = { roll_no: string; photo_file: string | null; name: string }

const BUCKET = 'player-photos'

export default function ImportPage() {
  return <OperatorGate>{(email) => <Importer email={email} />}</OperatorGate>
}

async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

function Importer({ email }: { email: string }) {
  const { data, reload } = useAuction('importer')

  const [rows, setRows] = useState<Cell[][] | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [map, setMap] = useState<ColumnMap | null>(null)
  const [excelName, setExcelName] = useState('')

  const [sources, setSources] = useState<PhotoSource[]>([])
  const [photoLabel, setPhotoLabel] = useState('')
  const [prepared, setPrepared] = useState<Map<string, Prepared>>(new Map())
  const preparedRef = useRef(prepared)
  preparedRef.current = prepared
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null)

  const [basePrice, setBasePrice] = useState('')
  const [replaceWanted, setReplace] = useState(true)
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => preparedRef.current.forEach((p) => 'url' in p && URL.revokeObjectURL(p.url)), [])

  useEffect(() => {
    if (data && basePrice === '') setBasePrice(String(data.settings.min_base))
  }, [data, basePrice])

  const sheet = useMemo(() => (rows && map ? parseRegistrationRows(rows, map) : null), [rows, map])
  const missingRequired = map ? REQUIRED_FIELDS.filter((f) => map[f] == null) : []
  const importable = sheet ? sheet.players.filter((p) => !p.issues.some((i) => i.level === 'error')) : []
  const skipped = sheet ? sheet.players.length - importable.length : 0

  const targets: Target[] = useMemo(
    () =>
      sheet
        ? sheet.players.filter((p) => p.roll_no).map((p) => ({ roll_no: p.roll_no, photo_file: p.photo_file, name: p.name }))
        : (data?.players ?? []).map((p) => ({ roll_no: p.roll_no, photo_file: null, name: p.name })),
    [sheet, data?.players],
  )
  const importableRolls = new Set(importable.map((p) => p.roll_no))

  const photoMatch = useMemo(() => matchPhotos(targets, sources.map((s) => s.path)), [targets, sources])
  const matchKey = [...new Set(photoMatch.matches.values())].sort().join('|')

  useEffect(() => {
    const byPath = new Map(sources.map((s) => [s.path, s]))
    const todo = matchKey ? matchKey.split('|').filter((p) => !preparedRef.current.has(p)) : []
    if (todo.length === 0) {
      setPreparing(null)
      return
    }
    let cancelled = false
    let done = 0
    setPreparing({ done, total: todo.length })
    void (async () => {
      for (const path of todo) {
        const source = byPath.get(path)
        if (!source || cancelled) return
        let entry: Prepared
        try {
          const blob = await preparePhoto(await source.load())
          entry = { blob, url: URL.createObjectURL(blob) }
        } catch (e) {
          entry = { error: errorMessage(e) }
        }
        if (cancelled) {
          if ('url' in entry) URL.revokeObjectURL(entry.url)
          return
        }
        setPrepared((prev) => new Map(prev).set(path, entry))
        setPreparing({ done: ++done, total: todo.length })
      }
      setPreparing(null)
    })()
    return () => {
      cancelled = true
    }
  }, [matchKey, sources])

  const readyPhotos = [...photoMatch.matches].filter(([roll, path]) => {
    const p = prepared.get(path)
    return p && 'blob' in p && (!sheet || importableRolls.has(roll))
  })

  const loadExcel = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setResult(null)
    setLoading('Reading the Excel sheet…')
    try {
      const cells = await readXlsxRows(file)
      const parsed = parseRegistrationRows(cells)
      setRows(cells)
      setHeaders(parsed.headers)
      setMap(parsed.map)
      setExcelName(file.name)
    } catch (err) {
      setError(`Could not read “${file.name}”. Upload the .xlsx file downloaded from Microsoft Forms. (${errorMessage(err)})`)
    } finally {
      setLoading(null)
    }
  }

  const loadPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (files.length === 0) return
    setError(null)
    setResult(null)
    setLoading('Opening photos…')
    try {
      const next: PhotoSource[] = []
      for (const file of files) {
        if (/\.zip$/i.test(file.name)) {
          const zip = await JSZip.loadAsync(file)
          zip.forEach((path, entry) => {
            if (entry.dir || path.startsWith('__MACOSX/') || (path.split('/').pop() ?? '').startsWith('.')) return
            next.push({ path, load: () => entry.async('blob') })
          })
        } else {
          next.push({ path: file.name, load: async () => file })
        }
      }
      prepared.forEach((p) => 'url' in p && URL.revokeObjectURL(p.url))
      setPrepared(new Map())
      setSources(next)
      setPhotoLabel(files.length === 1 ? files[0].name : `${files.length} files`)
    } catch (err) {
      setError(`Could not open the photos: ${errorMessage(err)}`)
    } finally {
      setLoading(null)
    }
  }

  const soldCount = data?.players.filter((p) => p.status === 'sold').length ?? 0
  const replace = replaceWanted && soldCount === 0
  const base = Number(basePrice)
  const baseValid = Number.isInteger(base) && base > 0
  const canImport =
    !importing &&
    !preparing &&
    (sheet ? importable.length > 0 && missingRequired.length === 0 && baseValid : readyPhotos.length > 0)

  const runImport = async () => {
    if (!canImport) return
    if (replace && !window.confirm(`Replace all ${data?.players.length ?? 0} current players with ${importable.length} from the sheet?`)) return
    setError(null)
    setResult(null)
    try {
      const stamp = Date.now()
      const urls = new Map<string, string>()
      let uploaded = 0
      setImporting(`Uploading photos… 0/${readyPhotos.length}`)
      await eachLimit(readyPhotos, 4, async ([roll, path]) => {
        const { blob } = prepared.get(path) as { blob: Blob }
        const objectPath = photoPath(roll, blob)
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(objectPath, blob, { upsert: true, contentType: blob.type, cacheControl: '3600' })
        if (uploadError) throw new Error(`Photo upload failed for ${roll}: ${errorMessage(uploadError)}`)
        urls.set(roll, `${supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl}?v=${stamp}`)
        setImporting(`Uploading photos… ${++uploaded}/${readyPhotos.length}`)
      })

      if (sheet) {
        setImporting('Saving players…')
        const payload = importable.map((p) => ({
          name: p.name,
          roll_no: p.roll_no,
          batch: p.batch,
          role: p.role,
          base_price: base,
          batting_style: p.batting_style,
          bowling_style: p.bowling_style,
          is_wicketkeeper: p.is_wicketkeeper,
          photo_url: urls.get(p.roll_no) ?? null,
        }))
        const { data: count, error: rpcError } = await supabase.rpc('import_players', { p_players: payload, p_replace: replace })
        if (rpcError) throw rpcError
        setResult(
          `${count} players ${replace ? 'now make up the pool' : 'added or updated'}, ${urls.size} with photos.` +
            (skipped ? ` ${skipped} rows skipped because of errors.` : ''),
        )
      } else {
        setImporting('Linking photos…')
        const items = [...urls].map(([roll_no, photo_url]) => ({ roll_no, photo_url }))
        const { data: count, error: rpcError } = await supabase.rpc('set_player_photos', { p_items: items })
        if (rpcError) throw rpcError
        setResult(`${count} player photos updated.`)
      }
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setImporting(null)
    }
  }

  const photoState = (p: Target): { label: string; kind: 'ok' | 'warn' | 'bad' | 'wait'; url?: string } => {
    const path = photoMatch.matches.get(p.roll_no)
    if (!path) return p.photo_file ? { label: 'Not in upload', kind: 'warn' } : { label: 'No photo in form', kind: 'bad' }
    const prep = prepared.get(path)
    if (!prep) return { label: 'Preparing…', kind: 'wait' }
    if ('error' in prep) return { label: prep.error, kind: 'bad' }
    return { label: 'Ready', kind: 'ok', url: prep.url }
  }

  const previewRows: ParsedPlayer[] = sheet
    ? onlyIssues
      ? sheet.players.filter((p) => p.issues.length > 0 || !photoMatch.matches.has(p.roll_no))
      : sheet.players
    : []

  return (
    <main className="import-page">
      <header className="topbar">
        <Brand subtitle="Import players" />
        <div className="topbar-actions">
          <Link className="btn ghost" to="/operator">
            ← Operator desk
          </Link>
          <span className="muted small">{email}</span>
        </div>
      </header>

      <div className="import-body">
        <section className="panel import-intro">
          <h2>Registration form → auction pool</h2>
          <p className="muted">
            Upload the Excel export of the Microsoft Form, then the photos (the zip OneDrive gives you when you download the
            form’s upload folder, or the image files themselves). Everything is checked here before anything is saved.
            Contact number and email columns are never read or stored.
          </p>
        </section>

        <div className="import-steps">
          <section className="panel import-step">
            <div className="step-no">1</div>
            <h3>Registration sheet</h3>
            <p className="muted small">The .xlsx file from Microsoft Forms → Responses → Open in Excel / Download.</p>
            <label className="btn primary file-btn">
              {excelName ? 'Choose a different sheet' : 'Choose Excel file'}
              <input type="file" accept=".xlsx" onChange={loadExcel} data-testid="excel-input" />
            </label>
            {excelName && (
              <p className="small">
                <strong>{excelName}</strong>
                {sheet && (
                  <>
                    {' '}
                    · {sheet.totalRows} responses · {sheet.players.length} unique players
                    {sheet.duplicatesRemoved > 0 && ` · ${sheet.duplicatesRemoved} repeat registrations merged`}
                    {sheet.womenExcluded > 0 &&
                      ` · ${sheet.womenExcluded} ${sheet.womenExcluded === 1 ? 'woman' : 'women'} left out (men-only auction)`}
                  </>
                )}
              </p>
            )}
            {!excelName && (
              <p className="muted small">
                Skip this to add photos to players already in the pool; name each photo with the roll number (e.g.
                25F101.jpg).
              </p>
            )}
          </section>

          <section className="panel import-step">
            <div className="step-no">2</div>
            <h3>Player photos</h3>
            <p className="muted small">
              A .zip of the form’s photo folder, or image files. Matched by the file name in the form, or by roll number.
            </p>
            <label className="btn primary file-btn">
              {photoLabel ? 'Choose different photos' : 'Choose zip or images'}
              <input type="file" accept=".zip,image/*" multiple onChange={loadPhotos} data-testid="photos-input" />
            </label>
            {photoLabel && (
              <p className="small">
                <strong>{photoLabel}</strong> · {sources.length} files · {photoMatch.matches.size} matched
                {photoMatch.unusedFiles.length > 0 && ` · ${photoMatch.unusedFiles.length} not matched to anyone`}
              </p>
            )}
            {preparing && (
              <div className="progress" aria-label="Preparing photos">
                <div style={{ width: `${(preparing.done / preparing.total) * 100}%` }} />
                <span>
                  Cropping photos {preparing.done}/{preparing.total}
                </span>
              </div>
            )}
          </section>

          <section className="panel import-step">
            <div className="step-no">3</div>
            <h3>Review and import</h3>
            {sheet && (
              <>
                <label className="inline-field">
                  Base price for every player
                  <input type="number" min={1} step={1} value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={replace}
                    disabled={soldCount > 0}
                    onChange={(e) => setReplace(e.target.checked)}
                  />
                  <span>
                    Replace the current pool ({data?.players.length ?? 0} players)
                    {soldCount > 0 && <span className="muted"> — reset the auction first, {soldCount} already sold</span>}
                  </span>
                </label>
                {replace ? (
                  <p className="muted small">
                    The pool becomes exactly the players in this sheet. Use this for each new form export, since it already
                    contains everyone who registered so far.
                  </p>
                ) : (
                  <p className="muted small">
                    Players are added, and anyone with the same roll number is updated. Nobody already in the pool is removed.
                  </p>
                )}
              </>
            )}
            <button className="btn sold block" disabled={!canImport} onClick={() => void runImport()}>
              {importing ??
                (sheet
                  ? `Import ${importable.length} players${readyPhotos.length ? ` with ${readyPhotos.length} photos` : ''}`
                  : readyPhotos.length
                    ? `Upload ${readyPhotos.length} photos to existing players`
                    : 'Import')}
            </button>
            {result && (
              <p className="import-result">
                ✓ {result}{' '}
                <a href="/projection" target="_blank" rel="noreferrer">
                  Open projection ↗
                </a>
              </p>
            )}
          </section>
        </div>

        {loading && <p className="muted">{loading}</p>}
        {error && <p className="form-error import-error">{error}</p>}
        {sheet && missingRequired.length > 0 && (
          <p className="form-error import-error">
            Could not find these columns: {missingRequired.map((f) => FIELD_LABELS[f]).join(', ')}. Pick them below.
          </p>
        )}

        {map && (
          <details className="panel mapping" open={missingRequired.length > 0}>
            <summary>
              Column mapping <span className="muted small">(detected automatically — change if a question was renamed)</span>
            </summary>
            <div className="mapping-grid">
              {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => (
                <label key={field}>
                  <span>
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) && ' *'}
                  </span>
                  <select
                    value={map[field] ?? ''}
                    onChange={(e) => setMap({ ...map, [field]: e.target.value === '' ? null : Number(e.target.value) })}
                  >
                    <option value="">— not used —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h.length > 60 ? `${h.slice(0, 57)}…` : h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>
        )}

        {sheet && (
          <section className="panel preview">
            <div className="panel-head">
              <h2>Preview</h2>
              <span className="muted small">
                {importable.length} ready · {skipped} with errors (skipped) · {readyPhotos.length} photos ready
              </span>
              <label className="check small">
                <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
                <span>Only rows needing attention</span>
              </label>
            </div>
            <div className="preview-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Photo</th>
                    <th>Name</th>
                    <th>Roll no</th>
                    <th>Role</th>
                    <th>Batting</th>
                    <th>Bowling</th>
                    <th>Checks</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((p) => {
                    const photo = photoState(p)
                    const hasError = p.issues.some((i) => i.level === 'error')
                    return (
                      <tr key={`${p.rowNumber}-${p.roll_no}`} className={hasError ? 'row-error' : ''}>
                        <td className="muted">{p.rowNumber}</td>
                        <td>
                          {photo.url ? (
                            <img className="avatar avatar-sm" src={photo.url} alt="" />
                          ) : (
                            <span className="avatar avatar-sm avatar-fallback">{initials(p.name || '?')}</span>
                          )}
                        </td>
                        <td>{p.name || <span className="muted">—</span>}</td>
                        <td>{p.roll_no || <span className="muted">—</span>}</td>
                        <td>
                          {p.role ? roleLabel(p.role) : <span className="muted">—</span>}
                          {p.batch && <span className="tag">{p.batch}</span>}
                        </td>
                        <td className="small">{p.batting_style ?? '—'}</td>
                        <td className="small">{p.bowling_style ?? '—'}</td>
                        <td>
                          <span className={`badge ${photo.kind}`}>{photo.label}</span>
                          {p.issues.map((i, n) => (
                            <span key={n} className={`badge ${i.level === 'error' ? 'bad' : 'warn'}`}>
                              {i.text}
                            </span>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                  {previewRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted">
                        Nothing needs attention.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!sheet && sources.length > 0 && (
          <section className="panel preview">
            <div className="panel-head">
              <h2>Photos for players already in the pool</h2>
              <span className="muted small">
                {photoMatch.matches.size} of {sources.filter((s) => isImageFile(s.path)).length} images match a player
              </span>
            </div>
            <div className="photo-grid">
              {targets
                .filter((t) => photoMatch.matches.has(t.roll_no))
                .map((t) => {
                  const photo = photoState(t)
                  return (
                    <figure key={t.roll_no}>
                      {photo.url ? (
                        <img className="avatar avatar-md" src={photo.url} alt="" />
                      ) : (
                        <span className="avatar avatar-md avatar-fallback">{initials(t.name)}</span>
                      )}
                      <figcaption>
                        {t.name}
                        <span className={`badge ${photo.kind}`}>{photo.label}</span>
                      </figcaption>
                    </figure>
                  )
                })}
            </div>
          </section>
        )}

        {data && <PoolTable data={data} />}
      </div>
    </main>
  )
}
