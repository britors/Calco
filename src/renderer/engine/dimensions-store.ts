import type { SerializedColWidth, SerializedRowHeight } from '@shared/model'

export const DEFAULT_ROW_HEIGHT = 24
export const DEFAULT_COL_WIDTH = 80

const MIN_ROW_HEIGHT = 8
const MIN_COL_WIDTH = 20

/** Sparse per-sheet row-height/column-width overrides. Presentation-only
 *  state HyperFormula knows nothing about, kept alongside it and reset/
 *  reloaded in lockstep with the engine -- same shape as StyleStore. */
export class DimensionsStore {
  private rowHeightsBySheet = new Map<number, Map<number, number>>()
  private colWidthsBySheet = new Map<number, Map<number, number>>()

  getRowHeight(sheetId: number, row: number): number {
    return this.rowHeightsBySheet.get(sheetId)?.get(row) ?? DEFAULT_ROW_HEIGHT
  }

  getColWidth(sheetId: number, col: number): number {
    return this.colWidthsBySheet.get(sheetId)?.get(col) ?? DEFAULT_COL_WIDTH
  }

  /** Returns the prior height (or `undefined` if it was still the default), for an undo entry. */
  setRowHeight(sheetId: number, row: number, height: number): number | undefined {
    const clamped = Math.max(MIN_ROW_HEIGHT, height)
    let map = this.rowHeightsBySheet.get(sheetId)
    const prior = map?.get(row)
    if (clamped === DEFAULT_ROW_HEIGHT) {
      map?.delete(row)
    } else {
      if (!map) {
        map = new Map()
        this.rowHeightsBySheet.set(sheetId, map)
      }
      map.set(row, clamped)
    }
    return prior
  }

  /** Returns the prior width (or `undefined` if it was still the default), for an undo entry. */
  setColWidth(sheetId: number, col: number, width: number): number | undefined {
    const clamped = Math.max(MIN_COL_WIDTH, width)
    let map = this.colWidthsBySheet.get(sheetId)
    const prior = map?.get(col)
    if (clamped === DEFAULT_COL_WIDTH) {
      map?.delete(col)
    } else {
      if (!map) {
        map = new Map()
        this.colWidthsBySheet.set(sheetId, map)
      }
      map.set(col, clamped)
    }
    return prior
  }

  /** Restores an exact (row, height) entry -- `undefined` height means "back to default". */
  restoreRowHeight(sheetId: number, row: number, height: number | undefined): void {
    if (height === undefined || height === DEFAULT_ROW_HEIGHT) {
      this.rowHeightsBySheet.get(sheetId)?.delete(row)
      return
    }
    let map = this.rowHeightsBySheet.get(sheetId)
    if (!map) {
      map = new Map()
      this.rowHeightsBySheet.set(sheetId, map)
    }
    map.set(row, height)
  }

  /** Restores an exact (col, width) entry -- `undefined` width means "back to default". */
  restoreColWidth(sheetId: number, col: number, width: number | undefined): void {
    if (width === undefined || width === DEFAULT_COL_WIDTH) {
      this.colWidthsBySheet.get(sheetId)?.delete(col)
      return
    }
    let map = this.colWidthsBySheet.get(sheetId)
    if (!map) {
      map = new Map()
      this.colWidthsBySheet.set(sheetId, map)
    }
    map.set(col, width)
  }

  removeSheet(sheetId: number): void {
    this.rowHeightsBySheet.delete(sheetId)
    this.colWidthsBySheet.delete(sheetId)
  }

  serializeRowHeights(sheetId: number): SerializedRowHeight[] {
    const map = this.rowHeightsBySheet.get(sheetId)
    if (!map) return []
    return Array.from(map, ([row, height]) => ({ row, height }))
  }

  serializeColWidths(sheetId: number): SerializedColWidth[] {
    const map = this.colWidthsBySheet.get(sheetId)
    if (!map) return []
    return Array.from(map, ([col, width]) => ({ col, width }))
  }

  /** Unconditionally replaces both maps for `sheetId` -- including with empty
   *  ones, which matters when this is used to restore an undo/redo snapshot
   *  back to "no overrides" (a fresh sheet load never has stale data to
   *  clear, but a restore might). */
  loadSheet(sheetId: number, rowHeights: SerializedRowHeight[], colWidths: SerializedColWidth[]): void {
    this.rowHeightsBySheet.set(sheetId, new Map(rowHeights.map(({ row, height }) => [row, height])))
    this.colWidthsBySheet.set(sheetId, new Map(colWidths.map(({ col, width }) => [col, width])))
  }

  /** Highest row/col index that has an explicit override on this sheet, or -1 if none. */
  maxOverriddenRow(sheetId: number): number {
    const map = this.rowHeightsBySheet.get(sheetId)
    return map && map.size > 0 ? Math.max(...map.keys()) : -1
  }

  maxOverriddenCol(sheetId: number): number {
    const map = this.colWidthsBySheet.get(sheetId)
    return map && map.size > 0 ? Math.max(...map.keys()) : -1
  }

  private shiftMap(bySheet: Map<number, Map<number, number>>, sheetId: number, map: (index: number) => number | null): void {
    const existing = bySheet.get(sheetId)
    if (!existing) return
    const shifted = new Map<number, number>()
    for (const [index, size] of existing) {
      const mapped = map(index)
      if (mapped !== null) shifted.set(mapped, size)
    }
    bySheet.set(sheetId, shifted)
  }

  insertRows(sheetId: number, at: number, count: number): void {
    this.shiftMap(this.rowHeightsBySheet, sheetId, (index) => (index >= at ? index + count : index))
  }

  deleteRows(sheetId: number, at: number, count: number): void {
    this.shiftMap(this.rowHeightsBySheet, sheetId, (index) => {
      if (index < at) return index
      if (index < at + count) return null
      return index - count
    })
  }

  insertCols(sheetId: number, at: number, count: number): void {
    this.shiftMap(this.colWidthsBySheet, sheetId, (index) => (index >= at ? index + count : index))
  }

  deleteCols(sheetId: number, at: number, count: number): void {
    this.shiftMap(this.colWidthsBySheet, sheetId, (index) => {
      if (index < at) return index
      if (index < at + count) return null
      return index - count
    })
  }
}
