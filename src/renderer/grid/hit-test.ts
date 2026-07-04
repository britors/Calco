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
  const col = Math.floor((x - metrics.headerWidth + scroll.scrollLeft) / metrics.colWidth)
  const row = Math.floor((y - metrics.headerHeight + scroll.scrollTop) / metrics.rowHeight)
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
  const col = Math.floor((x - metrics.headerWidth + scroll.scrollLeft) / metrics.colWidth)
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
  const row = Math.floor((y - metrics.headerHeight + scroll.scrollTop) / metrics.rowHeight)
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
    x: metrics.headerWidth + col * metrics.colWidth - scroll.scrollLeft,
    y: metrics.headerHeight + row * metrics.rowHeight - scroll.scrollTop,
    width: metrics.colWidth,
    height: metrics.rowHeight
  }
}
