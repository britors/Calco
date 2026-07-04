import { HyperFormula, DetailedCellError, ExportedCellChange } from 'hyperformula'
import type { SerializedCell, SerializedWorkbook } from '@shared/model'

export interface CellSnapshot {
  raw: string
  value: number | string | boolean | null
  error?: string
}

export interface CellRangeBounds {
  minRow: number
  maxRow: number
  minCol: number
  maxCol: number
}

export interface SheetInfo {
  id: number
  name: string
}

// Nominal grid capacity (spec section 4). Exported so renderer/grid/ can size
// its scrollable area and clamp selection against the same numbers, without
// depending on HyperFormula's lazily-grown internal sheet dimensions.
export const MAX_ROWS = 100_000
export const MAX_COLS = 1_000

export class EngineAdapter {
  private hf: HyperFormula
  private activeSheetId: number

  constructor() {
    this.hf = this.createEngine()
    const sheetName = this.hf.addSheet('Sheet1')
    const sheetId = this.hf.getSheetId(sheetName)
    if (sheetId === undefined) throw new Error('Failed to create initial sheet')
    this.activeSheetId = sheetId
    // Creating the initial sheet shouldn't itself be an undoable operation.
    this.hf.clearUndoStack()
    this.hf.clearRedoStack()
  }

  private createEngine(): HyperFormula {
    return HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3',
      maxRows: MAX_ROWS,
      maxColumns: MAX_COLS
      // TODO(locale): functionArgSeparator / decimalSeparator / language config
      // land here once the pt-BR presentation layer is built; canonical
      // persisted formulas stay English regardless (spec section 5).
    })
  }

  addSheet(name?: string): number {
    const sheetName = this.hf.addSheet(name)
    const sheetId = this.hf.getSheetId(sheetName)
    if (sheetId === undefined) throw new Error(`Failed to create sheet ${sheetName}`)
    return sheetId
  }

  listSheets(): SheetInfo[] {
    return this.hf.getSheetNames().map((name) => {
      const id = this.hf.getSheetId(name)
      if (id === undefined) throw new Error(`Sheet ${name} has no id`)
      return { id, name }
    })
  }

  getActiveSheetId(): number {
    return this.activeSheetId
  }

  setActiveSheetId(id: number): void {
    this.activeSheetId = id
  }

  /** May throw (e.g. SheetNameAlreadyTakenError) -- caller decides how to handle it. */
  renameSheet(id: number, name: string): void {
    this.hf.renameSheet(id, name)
  }

  /** No-ops rather than ever leaving the app with zero sheets. */
  removeSheet(id: number): void {
    if (this.hf.getSheetNames().length <= 1) return
    this.hf.removeSheet(id)
    if (this.activeSheetId === id) {
      const fallbackName = this.hf.getSheetNames()[0]
      const fallbackId = this.hf.getSheetId(fallbackName)
      if (fallbackId === undefined) throw new Error('No sheets remain after removal')
      this.activeSheetId = fallbackId
    }
  }

  // `setCellContents` grows the sheet's dimensions on its own, exactly to fit
  // whatever's written, up to `maxRows`/`maxColumns` -- no manual pre-growth
  // needed here. (An earlier manual grow-then-write approach here mirrored a
  // real limitation of `addRows`/`addColumns` in isolation -- those *do*
  // no-op on a still-empty sheet -- but calling them proactively as a
  // structural CRUD op has a side effect of invalidating HyperFormula's
  // clipboard, which is what broke `pasteAt` below before this was removed.)
  setCellContent(row: number, col: number, raw: string | number | boolean): CellSnapshot[] {
    // An empty string must clear the cell (HyperFormula's Empty content),
    // not be stored as a literal empty-string value.
    const content = raw === '' ? null : raw
    const changes = this.hf.setCellContents({ sheet: this.activeSheetId, row, col }, [[content]])
    return changes
      .filter((change): change is ExportedCellChange => change instanceof ExportedCellChange)
      .map((change) => this.getCellSnapshot(change.row, change.col))
  }

  getCellSnapshot(row: number, col: number): CellSnapshot {
    const address = { sheet: this.activeSheetId, row, col }
    const value = this.hf.getCellValue(address)
    const formula = this.hf.getCellFormula(address)
    if (value instanceof DetailedCellError) {
      return { raw: formula ?? value.value, value: null, error: value.value }
    }
    return { raw: formula ?? (value === null ? '' : String(value)), value }
  }

  getSheetDimensions(): { rows: number; cols: number } {
    const dims = this.hf.getSheetDimensions(this.activeSheetId)
    return { rows: dims.height, cols: dims.width }
  }

  /** Sparse export of every sheet -- suitable for JSON persistence (spec section 5). */
  serializeWorkbook(): SerializedWorkbook {
    const allSheets = this.hf.getAllSheetsSerialized()
    const names = this.hf.getSheetNames()
    const sheets = names.map((name) => {
      const dense = allSheets[name] ?? []
      const cells: SerializedCell[] = []
      dense.forEach((rowContents, row) => {
        rowContents.forEach((content, col) => {
          if (content === null || content === undefined || content === '') return
          if (content instanceof Date) return // date literals not supported yet
          cells.push({ row, col, content })
        })
      })
      return { name, cells }
    })

    const activeSheetName = this.hf.getSheetName(this.activeSheetId)
    const activeSheetIndex = Math.max(0, names.indexOf(activeSheetName ?? names[0]))

    return { formatVersion: 1, sheets, activeSheetIndex }
  }

  /** Replaces the entire engine state with `doc` (open/new-from-file). */
  loadWorkbook(doc: SerializedWorkbook): void {
    this.hf = this.createEngine()
    const sheetsToLoad = doc.sheets.length > 0 ? doc.sheets : [{ name: 'Sheet1', cells: [] }]
    const sheetIds: number[] = []

    // Batched purely for recalculation performance across many cells (deferred
    // until the whole load completes) -- undo-grouping doesn't matter here
    // since clearUndoStack() below makes the load a non-event either way.
    this.hf.batch(() => {
      for (const sheet of sheetsToLoad) {
        const sheetId = this.addSheet(sheet.name)
        sheetIds.push(sheetId)
        for (const cell of sheet.cells) {
          this.hf.setCellContents({ sheet: sheetId, row: cell.row, col: cell.col }, [[cell.content]])
        }
      }
    })

    const activeIndex = doc.activeSheetIndex >= 0 && doc.activeSheetIndex < sheetIds.length ? doc.activeSheetIndex : 0
    this.activeSheetId = sheetIds[activeIndex]
    // Loading a document shouldn't itself be an undoable operation.
    this.hf.clearUndoStack()
    this.hf.clearRedoStack()
  }

  canUndo(): boolean {
    return this.hf.isThereSomethingToUndo()
  }

  canRedo(): boolean {
    return this.hf.isThereSomethingToRedo()
  }

  /** No-ops (rather than throwing) when there's nothing to undo -- callers don't need to guard. */
  undo(): CellSnapshot[] {
    if (!this.hf.isThereSomethingToUndo()) return []
    return this.hf
      .undo()
      .filter((change): change is ExportedCellChange => change instanceof ExportedCellChange)
      .map((change) => this.getCellSnapshot(change.row, change.col))
  }

  redo(): CellSnapshot[] {
    if (!this.hf.isThereSomethingToRedo()) return []
    return this.hf
      .redo()
      .filter((change): change is ExportedCellChange => change instanceof ExportedCellChange)
      .map((change) => this.getCellSnapshot(change.row, change.col))
  }

  copyRange(range: CellRangeBounds): void {
    this.hf.copy(this.toSimpleCellRange(range))
  }

  cutRange(range: CellRangeBounds): void {
    this.hf.cut(this.toSimpleCellRange(range))
  }

  isClipboardEmpty(): boolean {
    return this.hf.isClipboardEmpty()
  }

  clearClipboard(): void {
    this.hf.clearClipboard()
  }

  /** No-op (rather than throwing) when the clipboard is empty. `paste` grows the sheet on its own. */
  pasteAt(row: number, col: number): CellSnapshot[] {
    if (this.hf.isClipboardEmpty()) return []
    const changes = this.hf.paste({ sheet: this.activeSheetId, row, col })
    return changes
      .filter((change): change is ExportedCellChange => change instanceof ExportedCellChange)
      .map((change) => this.getCellSnapshot(change.row, change.col))
  }

  /** Writes a parsed-TSV block (external paste) starting at (row, col). */
  pasteExternalRows(row: number, col: number, rows: (string | number | boolean)[][]): void {
    this.hf.batch(() => {
      rows.forEach((rowValues, rOffset) => {
        rowValues.forEach((value, cOffset) => {
          const content = value === '' ? null : value
          this.hf.setCellContents({ sheet: this.activeSheetId, row: row + rOffset, col: col + cOffset }, [[content]])
        })
      })
    })
  }

  private toSimpleCellRange(range: CellRangeBounds) {
    return {
      start: { sheet: this.activeSheetId, row: range.minRow, col: range.minCol },
      end: { sheet: this.activeSheetId, row: range.maxRow, col: range.maxCol }
    }
  }
}
