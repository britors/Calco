import type { CellRangeBounds, EngineAdapter } from '../engine/engine-adapter'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Tab-separated values -- the de facto plain-text interchange format Excel/Sheets use. */
export function buildTsv(engine: EngineAdapter, range: CellRangeBounds): string {
  const rows: string[] = []
  for (let row = range.minRow; row <= range.maxRow; row++) {
    const cells: string[] = []
    for (let col = range.minCol; col <= range.maxCol; col++) {
      cells.push(engine.getCellSnapshot(row, col).raw)
    }
    rows.push(cells.join('\t'))
  }
  return rows.join('\n')
}

/** Bare <table> shell -- no styling yet (no formatting system exists), just cell boundaries. */
export function buildHtmlTable(engine: EngineAdapter, range: CellRangeBounds): string {
  const rows: string[] = []
  for (let row = range.minRow; row <= range.maxRow; row++) {
    const cells: string[] = []
    for (let col = range.minCol; col <= range.maxCol; col++) {
      cells.push(`<td>${escapeHtml(engine.getCellSnapshot(row, col).raw)}</td>`)
    }
    rows.push(`<tr>${cells.join('')}</tr>`)
  }
  return `<table>${rows.join('')}</table>`
}

/** Computed values (not formulas) for a range -- used for "paste values only". */
export function buildValuesMatrix(engine: EngineAdapter, range: CellRangeBounds): (string | number | boolean)[][] {
  const rows: (string | number | boolean)[][] = []
  for (let row = range.minRow; row <= range.maxRow; row++) {
    const cells: (string | number | boolean)[] = []
    for (let col = range.minCol; col <= range.maxCol; col++) {
      const value = engine.getCellSnapshot(row, col).value
      cells.push(value === null ? '' : value)
    }
    rows.push(cells)
  }
  return rows
}

function coerceCell(text: string): string | number {
  if (text.trim() === '') return ''
  const asNumber = Number(text)
  return Number.isFinite(asNumber) ? asNumber : text
}

/** Parses TSV (or plain single-column) text into a 2D block, coercing numeric-looking cells. */
export function parseTsv(text: string): (string | number | boolean)[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  // Drop a single trailing blank line (common when copying from Excel/Sheets).
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => line.split('\t').map(coerceCell))
}
