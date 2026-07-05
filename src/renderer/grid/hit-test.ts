import type { GridMetrics, ScrollState } from './viewport'

export interface CellHit {
  row: number
  col: number
}

/** Canvas-relative (x, y) -> (row, col), or null if inside the header strips. */
export function hitTest(
  x: number,
  y: number,
  metrics: GridMetrics,
  scroll: Pick<ScrollState, 'scrollTop' | 'scrollLeft'>
): CellHit | null {
  if (x < metrics.headerWidth || y < metrics.headerHeight) return null
  const col = metrics.colSizer.indexAt(x - metrics.headerWidth + scroll.scrollLeft)
  const row = metrics.rowSizer.indexAt(y - metrics.headerHeight + scroll.scrollTop)
  if (row < 0 || col < 0) return null
  return { row, col }
}

/** Hit-tests the column header strip (y within the header, x past the row-header strip). */
export function hitTestColumnHeader(
  x: number,
  y: number,
  metrics: GridMetrics,
  scroll: Pick<ScrollState, 'scrollLeft'>
): number | null {
  if (y >= metrics.headerHeight || x < metrics.headerWidth) return null
  const col = metrics.colSizer.indexAt(x - metrics.headerWidth + scroll.scrollLeft)
  return col < 0 ? null : col
}

/** Hit-tests the row header strip (x within the header, y past the column-header strip). */
export function hitTestRowHeader(
  x: number,
  y: number,
  metrics: GridMetrics,
  scroll: Pick<ScrollState, 'scrollTop'>
): number | null {
  if (x >= metrics.headerWidth || y < metrics.headerHeight) return null
  const row = metrics.rowSizer.indexAt(y - metrics.headerHeight + scroll.scrollTop)
  return row < 0 ? null : row
}

export interface CellRect {
  x: number
  y: number
  width: number
  height: number
}

/** (row, col) -> on-screen rect in the same coordinate space as the canvas. */
export function cellRect(
  row: number,
  col: number,
  metrics: GridMetrics,
  scroll: Pick<ScrollState, 'scrollTop' | 'scrollLeft'>
): CellRect {
  return {
    x: metrics.headerWidth + metrics.colSizer.offsetOf(col) - scroll.scrollLeft,
    y: metrics.headerHeight + metrics.rowSizer.offsetOf(row) - scroll.scrollTop,
    width: metrics.colSizer.sizeOf(col),
    height: metrics.rowSizer.sizeOf(row)
  }
}

/** Distance in px from (x, y) to the nearest column-boundary line in the header
 *  strip, and which boundary (the column whose *right* edge it is). Used to
 *  detect a resize-drag start near a header edge. `null` outside a hit zone. */
export function hitTestColumnBoundary(
  x: number,
  y: number,
  metrics: GridMetrics,
  scroll: Pick<ScrollState, 'scrollLeft'>,
  tolerancePx: number
): number | null {
  if (y >= metrics.headerHeight) return null
  const localX = x - metrics.headerWidth + scroll.scrollLeft
  if (localX < 0) return null
  const col = metrics.colSizer.indexAt(localX)
  const colStart = metrics.colSizer.offsetOf(col)
  const colEnd = colStart + metrics.colSizer.sizeOf(col)
  if (Math.abs(localX - colEnd) <= tolerancePx) return col
  if (col > 0 && Math.abs(localX - colStart) <= tolerancePx) return col - 1
  return null
}

/** Same idea as hitTestColumnBoundary, for the row-header strip. */
export function hitTestRowBoundary(
  x: number,
  y: number,
  metrics: GridMetrics,
  scroll: Pick<ScrollState, 'scrollTop'>,
  tolerancePx: number
): number | null {
  if (x >= metrics.headerWidth) return null
  const localY = y - metrics.headerHeight + scroll.scrollTop
  if (localY < 0) return null
  const row = metrics.rowSizer.indexAt(localY)
  const rowStart = metrics.rowSizer.offsetOf(row)
  const rowEnd = rowStart + metrics.rowSizer.sizeOf(row)
  if (Math.abs(localY - rowEnd) <= tolerancePx) return row
  if (row > 0 && Math.abs(localY - rowStart) <= tolerancePx) return row - 1
  return null
}
