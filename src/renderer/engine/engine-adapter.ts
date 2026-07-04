import { HyperFormula, DetailedCellError, ExportedCellChange } from 'hyperformula'
import type { SerializedCell, SerializedWorkbook } from '@shared/model'

export interface CellSnapshot {
  raw: string
  value: number | string | boolean | null
  error?: string
}

// Nominal grid capacity (spec section 4). Exported so renderer/grid/ can size
// its scrollable area and clamp selection against the same numbers, without
// depending on HyperFormula's lazily-grown internal sheet dimensions.
export const MAX_ROWS = 100_000
export const MAX_COLS = 1_000
const GROWTH_CHUNK = 1_000

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

  private ensureDimensions(sheetId: number, row: number, col: number): void {
    const dims = this.hf.getSheetDimensions(sheetId)
    if (row >= dims.height) {
      const target = Math.min(MAX_ROWS, Math.max(row + 1, dims.height + GROWTH_CHUNK))
      const need = target - dims.height
      if (need > 0) this.hf.addRows(sheetId, [dims.height, need])
    }
    if (col >= dims.width) {
      const target = Math.min(MAX_COLS, Math.max(col + 1, dims.width + GROWTH_CHUNK))
      const need = target - dims.width
      if (need > 0) this.hf.addColumns(sheetId, [dims.width, need])
    }
  }

  addSheet(name?: string): number {
    const sheetName = this.hf.addSheet(name)
    const sheetId = this.hf.getSheetId(sheetName)
    if (sheetId === undefined) throw new Error(`Failed to create sheet ${sheetName}`)
    return sheetId
  }

  setCellContent(row: number, col: number, raw: string | number | boolean): CellSnapshot[] {
    // An empty string must clear the cell (HyperFormula's Empty content),
    // not be stored as a literal empty-string value.
    const content = raw === '' ? null : raw
    // Batched so dimension growth + the content write land as a single
    // undo-stack entry (spec section 6: "agrupamento de ações compostas") --
    // otherwise one edit near the sheet's edge could take 2-3 Ctrl+Z presses.
    const changes = this.hf.batch(() => {
      this.ensureDimensions(this.activeSheetId, row, col)
      this.hf.setCellContents({ sheet: this.activeSheetId, row, col }, [[content]])
    })
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

    this.hf.batch(() => {
      for (const sheet of sheetsToLoad) {
        const sheetId = this.addSheet(sheet.name)
        sheetIds.push(sheetId)
        for (const cell of sheet.cells) {
          this.ensureDimensions(sheetId, cell.row, cell.col)
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
}
