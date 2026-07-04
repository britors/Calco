import type { EngineAdapter } from '../engine/engine-adapter'

export interface CellMatch {
  row: number
  col: number
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive substring search over the active sheet's raw cell content. */
export function findMatches(engine: EngineAdapter, query: string): CellMatch[] {
  if (!query) return []
  const needle = query.toLowerCase()
  const dims = engine.getSheetDimensions()
  const matches: CellMatch[] = []

  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      const raw = engine.getCellSnapshot(row, col).raw
      if (raw && raw.toLowerCase().includes(needle)) {
        matches.push({ row, col })
      }
    }
  }
  return matches
}

/** Replaces all occurrences of `query` within one cell's raw content (case-insensitive). */
export function replaceInCell(
  engine: EngineAdapter,
  row: number,
  col: number,
  query: string,
  replacement: string
): void {
  const raw = engine.getCellSnapshot(row, col).raw
  const pattern = new RegExp(escapeRegExp(query), 'gi')
  engine.setCellContent(row, col, raw.replace(pattern, replacement))
}

/** Replaces every match in the sheet; safe in one pass since content replacement never shifts positions. */
export function replaceAll(engine: EngineAdapter, query: string, replacement: string): number {
  const matches = findMatches(engine, query)
  for (const match of matches) {
    replaceInCell(engine, match.row, match.col, query, replacement)
  }
  return matches.length
}
