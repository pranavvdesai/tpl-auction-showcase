import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { detectColumns, mapBowling, mapRole, matchPhotos, parseRegistrationRows, photoFileFromLink, titleCase } from './importer'
import { readXlsxRows, type Cell } from './xlsx'

const HEADERS = [
  'ID',
  'Start time',
  'Completion time',
  'Email',
  'Name',
  'Last modified time',
  'NAME',
  'TAPMI ROLL NO',
  'CONTACT NUMBER',
  'BATTING TYPE',
  'BOWLING HAND',
  'BOWLING TYPE',
  'WICKETKEEPING',
  '"WHAT IS YOUR PRIMARY ROLE IN TEAM"?"\n',
  'HD PHOTOGRAPH',
]

const link = (file: string) =>
  `https://example-my.sharepoint.com/personal/x/Documents/Apps/Microsoft%20Forms/Form/Question/${encodeURIComponent(file)}`

// Fictional rows shaped like a real Microsoft Forms export.
const ROWS: Cell[][] = [
  HEADERS,
  [1, 45955.1, 45955.2, 'a@x.edu', 'ASHA RAO 1', null, '  asha   RAO ', '25f101', '9000000001', 'RIGHT HAND BATSMAN', 'RIGHT HAND\u00a0', 'PACE', 'NO', 'BATSMAN', link('IMG_1_ASHA RAO 1.jpg')],
  [2, 45955.3, 45955.4, 'b@x.edu', 'VIK DAS 2', null, 'Vik Das', '24B12', '9000000002', 'LEFT HAND BATSMAN', 'LEFT HAND\u00a0', 'LEG SPIN', 'YES', 'ALLROUNDER', link('Photo_VIK DAS 2.jpeg')],
  [3, 45955.5, 45955.6, 'a@x.edu', 'ASHA RAO 1', null, 'Asha Rao', '25F101', '9000000001', 'RIGHT HAND BATSMAN', 'RIGHT HAND\u00a0', 'OFF SPIN', 'NO', 'ALLROUNDER', link('IMG_2_ASHA RAO 1.png')],
  [4, 45955.7, 45955.8, 'c@x.edu', 'C 3', null, 'Ravi Kumar', '251600123', '9000000003', 'RIGHT HAND BATSMAN', 'RIGHT HAND\u00a0', 'PACE', 'NO', 'BOWLER', link('scan_C 3.pdf')],
]

async function buildFormsXlsx(rows: Cell[][]): Promise<Uint8Array> {
  const strings: string[] = []
  const idx = (s: string) => {
    let i = strings.indexOf(s)
    if (i < 0) i = strings.push(s) - 1
    return i
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const col = (i: number) => String.fromCharCode(65 + i)
  const rowXml = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${col(ci)}${ri + 1}`
          if (v == null) return ''
          if (typeof v === 'number') return `<x:c r="${ref}"><x:v>${v}</x:v></x:c>`
          return `<x:c r="${ref}" t="s"><x:v>${idx(String(v))}</x:v></x:c>`
        })
        .join('')
      return `<x:row r="${ri + 1}">${cells}</x:row>`
    })
    .join('')
  const ns = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  const zip = new JSZip()
  zip.file('xl/workbook.xml', `<x:workbook ${ns}><x:sheets><x:sheet name="Sheet1" sheetId="1" r:id="R1" /></x:sheets></x:workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="R1" Type="worksheet" Target="/xl/worksheets/sheet1.xml" /></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', `<x:worksheet ${ns}><x:dimension ref="A1" /><x:sheetData>${rowXml}</x:sheetData></x:worksheet>`)
  zip.file(
    'xl/sharedStrings.xml',
    `<x:sst ${ns}>${strings.map((s) => `<x:si><x:t xml:space="preserve">${esc(s)}</x:t></x:si>`).join('')}</x:sst>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}

describe('readXlsxRows', () => {
  it('reads every row of a Forms export despite the wrong dimension and x: prefixes', async () => {
    const rows = await readXlsxRows(await buildFormsXlsx(ROWS))
    expect(rows).toHaveLength(ROWS.length)
    expect(rows[0][13]).toBe('"WHAT IS YOUR PRIMARY ROLE IN TEAM"?"\n')
    expect(rows[1][6]).toBe('  asha   RAO ')
    expect(rows[2][2]).toBe(45955.4)
    expect(rows[1][5]).toBeNull()
  })
})

describe('column detection', () => {
  it('maps form questions and ignores the respondent account Name/Email and contact columns', () => {
    const map = detectColumns(HEADERS)
    expect(map).toEqual({
      submitted_at: 2,
      name: 6,
      roll_no: 7,
      batting: 9,
      bowling_hand: 10,
      bowling_type: 11,
      wicketkeeping: 12,
      role: 13,
      photo: 14,
    })
  })
})

describe('value mapping', () => {
  it('normalises names, roles, bowling and photo links', () => {
    expect(titleCase('  asha   RAO ')).toBe('Asha Rao')
    expect(titleCase("d'souza-pereira")).toBe("D'Souza-Pereira")
    expect(mapRole('ALLROUNDER')).toBe('All-rounder')
    expect(mapRole('BATSMAN')).toBe('Batter')
    expect(mapRole('BOWLER')).toBe('Bowler')
    expect(mapRole('???')).toBeNull()
    expect(mapBowling('LEFT HAND\u00a0', 'LEG SPIN')).toBe('Left-arm leg-spin')
    expect(mapBowling('RIGHT HAND', 'PACE')).toBe('Right-arm pace')
    expect(photoFileFromLink(link('IMG_1_ASHA RAO 1.jpg'))).toBe('IMG_1_ASHA RAO 1.jpg')
  })
})

describe('parseRegistrationRows', () => {
  const sheet = parseRegistrationRows(ROWS)

  it('keeps only the latest response per roll number', () => {
    expect(sheet.totalRows).toBe(4)
    expect(sheet.duplicatesRemoved).toBe(1)
    const asha = sheet.players.find((p) => p.roll_no === '25F101')!
    expect(asha.role).toBe('All-rounder')
    expect(asha.photo_file).toBe('IMG_2_ASHA RAO 1.png')
    expect(asha.issues.some((i) => i.text.includes('Registered 2 times'))).toBe(true)
  })

  it('fills player fields and flags problems without failing the import', () => {
    const vik = sheet.players.find((p) => p.roll_no === '24B12')!
    expect(vik).toMatchObject({
      name: 'Vik Das',
      batch: '2024 intake',
      batting_style: 'Left-hand bat',
      bowling_style: 'Left-arm leg-spin',
      is_wicketkeeper: true,
    })
    const ravi = sheet.players.find((p) => p.name === 'Ravi Kumar')!
    expect(ravi.issues.map((i) => i.text)).toEqual(
      expect.arrayContaining([expect.stringContaining('looks unusual'), 'Uploaded photo is not an image file']),
    )
  })

  it('never carries contact details into player records', () => {
    const json = JSON.stringify(sheet.players)
    expect(json).not.toContain('9000000001')
    expect(json).not.toContain('a@x.edu')
  })
})

describe('matchPhotos', () => {
  it('matches files by the exact name in the form link, falling back to a loose match', () => {
    const { matches, unusedFiles } = matchPhotos(
      [
        { roll_no: '25F101', photo_file: 'IMG_2_ASHA RAO 1.png' },
        { roll_no: '24B12', photo_file: 'Photo_VIK DAS 2.jpeg' },
        { roll_no: '99X1', photo_file: null },
      ],
      ['Question/IMG_2_ASHA RAO 1.png', 'photo_vik das 2.JPEG', 'someone_else.jpg'],
    )
    expect(matches.get('25F101')).toBe('Question/IMG_2_ASHA RAO 1.png')
    expect(matches.get('24B12')).toBe('photo_vik das 2.JPEG')
    expect(unusedFiles).toEqual(['someone_else.jpg'])
  })
})
