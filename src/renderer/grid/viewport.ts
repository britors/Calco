export interface GridMetrics {
  rowHeight: number
  colWidth: number
  headerWidth: number
  headerHeight: number
}

export interface ScrollState {
  scrollTop: number
  scrollLeft: number
  viewportWidth: number
  viewportHeight: number
}

export interface VisibleRange {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

const BUFFER_ROWS = 3
const BUFFER_COLS = 2

/** Pure function: visible row/col range from scroll offset + uniform sizing. */
export function computeVisibleRange(
  metrics: GridMetrics,
  scroll: ScrollState,
  maxRow: number,
  maxCol: number
): VisibleRange {
  const bodyHeight = Math.max(0, scroll.viewportHeight - metrics.headerHeight)
  const bodyWidth = Math.max(0, scroll.viewportWidth - metrics.headerWidth)

  const startRow = Math.max(0, Math.floor(scroll.scrollTop / metrics.rowHeight) - BUFFER_ROWS)
  const endRow = Math.min(
    maxRow,
    Math.ceil((scroll.scrollTop + bodyHeight) / metrics.rowHeight) + BUFFER_ROWS
  )
  const startCol = Math.max(0, Math.floor(scroll.scrollLeft / metrics.colWidth) - BUFFER_COLS)
  const endCol = Math.min(
    maxCol,
    Math.ceil((scroll.scrollLeft + bodyWidth) / metrics.colWidth) + BUFFER_COLS
  )

  return { startRow, endRow, startCol, endCol }
}
