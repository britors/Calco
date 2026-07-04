import { EngineAdapter, MAX_COLS, MAX_ROWS } from '../engine/engine-adapter'
import type { NormalizedRange } from './selection'

function isCellEmpty(engine: EngineAdapter, row: number, col: number): boolean {
  const snapshot = engine.getCellSnapshot(row, col)
  return snapshot.value === null && !snapshot.error
}

function rangeHasContent(
  engine: EngineAdapter,
  minRow: number,
  maxRow: number,
  minCol: number,
  maxCol: number
): boolean {
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!isCellEmpty(engine, row, col)) return true
    }
  }
  return false
}

/**
 * Excel-style "current region": the contiguous non-empty block around
 * (row, col), grown one edge at a time while the adjacent row/column has any
 * content, until no edge can grow. An empty starting cell selects just
 * itself (matches Excel's Ctrl+A on a blank cell).
 */
export function computeUsedRegion(engine: EngineAdapter, row: number, col: number): NormalizedRange {
  if (isCellEmpty(engine, row, col)) {
    return { minRow: row, maxRow: row, minCol: col, maxCol: col }
  }

  let minRow = row
  let maxRow = row
  let minCol = col
  let maxCol = col
  let grew = true

  while (grew) {
    grew = false
    if (minRow > 0 && rangeHasContent(engine, minRow - 1, minRow - 1, minCol, maxCol)) {
      minRow -= 1
      grew = true
    }
    if (maxRow < MAX_ROWS - 1 && rangeHasContent(engine, maxRow + 1, maxRow + 1, minCol, maxCol)) {
      maxRow += 1
      grew = true
    }
    if (minCol > 0 && rangeHasContent(engine, minRow, maxRow, minCol - 1, minCol - 1)) {
      minCol -= 1
      grew = true
    }
    if (maxCol < MAX_COLS - 1 && rangeHasContent(engine, minRow, maxRow, maxCol + 1, maxCol + 1)) {
      maxCol += 1
      grew = true
    }
  }

  return { minRow, maxRow, minCol, maxCol }
}
