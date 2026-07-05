/**
 * Cumulative pixel offsets for one grid axis (rows or columns) where most
 * indices use a single default size but any index may carry an explicit
 * override (see DimensionsStore). Exact prefix-sum + binary search up to
 * `bound`, then arithmetic extrapolation at `defaultSize` beyond it -- avoids
 * ever building a 100,000-entry array just because one row was resized.
 */
export class AxisSizer {
  private prefix = new Float64Array(1)
  private bound = 0

  constructor(
    private readonly defaultSize: number,
    private readonly getSize: (index: number) => number
  ) {}

  /** Recomputes the exact prefix sums for indices [0, bound). Call whenever
   *  an override changes, the active sheet switches, or a document loads --
   *  never on every render. */
  rebuild(bound: number): void {
    this.bound = Math.max(0, bound)
    this.prefix = new Float64Array(this.bound + 1)
    for (let i = 0; i < this.bound; i++) {
      this.prefix[i + 1] = this.prefix[i] + this.getSize(i)
    }
  }

  /** Pixel offset of the start of `index`. */
  offsetOf(index: number): number {
    if (index <= this.bound) return this.prefix[index]
    return this.prefix[this.bound] + (index - this.bound) * this.defaultSize
  }

  sizeOf(index: number): number {
    return this.getSize(index)
  }

  /** Inverse of offsetOf: which index contains pixel position `pos`. */
  indexAt(pos: number): number {
    if (pos <= 0) return 0
    const boundOffset = this.prefix[this.bound]
    if (pos >= boundOffset) {
      return this.bound + Math.floor((pos - boundOffset) / this.defaultSize)
    }
    let lo = 0
    let hi = this.bound
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.prefix[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Total pixel size of the first `count` indices (0..count-1). */
  totalSize(count: number): number {
    return this.offsetOf(count)
  }
}

export interface GridMetrics {
  headerWidth: number
  headerHeight: number
  rowSizer: AxisSizer
  colSizer: AxisSizer
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

/** Pure function: visible row/col range from scroll offset + per-axis sizing. */
export function computeVisibleRange(
  metrics: GridMetrics,
  scroll: ScrollState,
  maxRow: number,
  maxCol: number
): VisibleRange {
  const bodyHeight = Math.max(0, scroll.viewportHeight - metrics.headerHeight)
  const bodyWidth = Math.max(0, scroll.viewportWidth - metrics.headerWidth)

  const startRow = Math.max(0, metrics.rowSizer.indexAt(scroll.scrollTop) - BUFFER_ROWS)
  const endRow = Math.min(maxRow, metrics.rowSizer.indexAt(scroll.scrollTop + bodyHeight) + BUFFER_ROWS)
  const startCol = Math.max(0, metrics.colSizer.indexAt(scroll.scrollLeft) - BUFFER_COLS)
  const endCol = Math.min(maxCol, metrics.colSizer.indexAt(scroll.scrollLeft + bodyWidth) + BUFFER_COLS)

  return { startRow, endRow, startCol, endCol }
}
