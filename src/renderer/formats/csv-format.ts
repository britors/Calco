import type { SerializedCell, SerializedSheet } from '@shared/model'

export type CsvEncoding = 'utf-8' | 'windows-1252'

export const CSV_ENCODINGS: { value: CsvEncoding; label: string }[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'windows-1252', label: 'Windows-1252 (Latin-1)' }
]

export const CSV_DELIMITERS: { value: string; label: string }[] = [
  { value: ';', label: 'Ponto e vírgula ( ; ) — padrão pt-BR' },
  { value: ',', label: 'Vírgula ( , )' },
  { value: '\t', label: 'Tabulação' }
]

export function decodeCsvBytes(bytes: Uint8Array, encoding: CsvEncoding): string {
  return new TextDecoder(encoding).decode(bytes)
}

/** RFC4180-ish parse: quoted fields may embed the delimiter, newlines, and `""` for a literal quote. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  let i = 0
  while (i < normalized.length) {
    const ch = normalized[i]

    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function quoteField(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function stringifyDelimited(rows: (string | number | boolean)[][], delimiter: string): string {
  return rows.map((row) => row.map((cell) => quoteField(String(cell), delimiter)).join(delimiter)).join('\n')
}

/** `;` is the pt-BR delimiter convention, which pairs with `,` as the decimal
 *  separator (spec section 3); anything else assumes the international `.`
 *  decimal. No thousand-separator support, matching the same MVP scope cut
 *  made for the pt-BR formula locale. */
function coerceCsvCell(raw: string, delimiter: string): string | number | boolean {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  const lower = trimmed.toLowerCase()
  if (lower === 'true' || lower === 'verdadeiro') return true
  if (lower === 'false' || lower === 'falso') return false

  const candidate = delimiter === ';' ? trimmed.replace(',', '.') : trimmed
  const asNumber = Number(candidate)
  return Number.isFinite(asNumber) ? asNumber : raw
}

/** Parsed + type-coerced CSV text -> a single SerializedSheet, ready to feed
 *  straight into EngineAdapter.loadWorkbook (wrapped in a one-sheet document). */
export function csvTextToSheet(text: string, delimiter: string, sheetName: string): SerializedSheet {
  const rows = parseDelimited(text, delimiter)
  const cells: SerializedCell[] = []
  rows.forEach((row, r) => {
    row.forEach((raw, c) => {
      const content = coerceCsvCell(raw, delimiter)
      if (content === '') return
      cells.push({ row: r, col: c, content })
    })
  })
  return { name: sheetName, cells }
}
