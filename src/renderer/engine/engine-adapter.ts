import { HyperFormula, DetailedCellError, ExportedCellChange } from 'hyperformula'
import type {
  CellStyle,
  SerializedCell,
  SerializedColWidth,
  SerializedMerge,
  SerializedRowHeight,
  SerializedWorkbook
} from '@shared/model'
import { LOCALE_CODE, ensureLocaleRegistered, toCanonicalFormula, toDisplayFormula } from './formula-locale'
import { StyleStore, type CellPos, type StyleSnapshotEntry } from './style-store'
import { DimensionsStore } from './dimensions-store'

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

// HyperFormula only ever tracks cell *content* in its own undo/redo stack --
// it has no idea styles or merges exist. Rather than bolt a second undo
// system next to it, every mutating call here pushes exactly one marker onto
// a single chronological stack: a 'content' marker delegates the actual
// undo/redo to HyperFormula (which stays the source of truth for relative-
// reference-aware content changes), while 'style'/'merge' markers carry a
// self-contained before/after snapshot and are reverted directly. As long as
// every hf-mutating call here pushes exactly one 'content' marker (verified
// case by case below -- hf.cut() alone pushes none, only the paste that
// follows it does), the two histories stay in lockstep and Ctrl+Z undoes
// whatever happened most recently, content or formatting alike.
interface ContentUndoMarker {
  kind: 'content'
}
interface StyleUndoMarker {
  kind: 'style'
  sheetId: number
  before: StyleSnapshotEntry[]
  after: StyleSnapshotEntry[]
}
interface MergeUndoMarker {
  kind: 'merge'
  sheetId: number
  before: SerializedMerge[]
  after: SerializedMerge[]
}
interface DimensionUndoMarker {
  kind: 'dimension'
  sheetId: number
  axis: 'row' | 'col'
  index: number
  before: number | undefined
  after: number
}
// Inserting/deleting rows or columns shifts cell content (which hf.undo/redo
// already tracks precisely, formula references and all) *and* shifts every
// style/merge/dimension entry on the sheet, which hf knows nothing about.
// Rather than compute a precise incremental diff for the latter, a
// 'structure' marker just snapshots the whole auxiliary (style/merge/
// dimension) state before and after -- cheap given how little of that data
// typically exists -- and undo/redo restores it wholesale alongside the
// hf.undo()/redo() call that handles content.
interface AuxSnapshot {
  styles: StyleSnapshotEntry[]
  merges: SerializedMerge[]
  rowHeights: SerializedRowHeight[]
  colWidths: SerializedColWidth[]
}
interface StructureUndoMarker {
  kind: 'structure'
  sheetId: number
  before: AuxSnapshot
  after: AuxSnapshot
}
type UndoMarker = ContentUndoMarker | StyleUndoMarker | MergeUndoMarker | DimensionUndoMarker | StructureUndoMarker

export class EngineAdapter {
  private hf: HyperFormula
  private activeSheetId: number
  private styleStore = new StyleStore()
  private dimensionsStore = new DimensionsStore()
  private undoStack: UndoMarker[] = []
  private redoStack: UndoMarker[] = []

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
    ensureLocaleRegistered()
    return HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3',
      maxRows: MAX_ROWS,
      maxColumns: MAX_COLS,
      // Function names, argument separator and decimal separator are all
      // pt-BR here (spec section 3); English function names are still
      // accepted on input (HyperFormula normalizes either spelling to the
      // configured language on read-back). Persisted formulas are translated
      // to/from canonical English at the serialize/load boundary below
      // (spec section 5) -- the engine itself never runs in English.
      language: LOCALE_CODE,
      functionArgSeparator: ';',
      decimalSeparator: ',',
      thousandSeparator: '.'
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
    this.styleStore.removeSheet(id)
    this.dimensionsStore.removeSheet(id)
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
    // Unconditional: hf always registers a CRUD undo entry here, even for a
    // value-identical or empty-to-empty write (verified empirically).
    this.pushMarker({ kind: 'content' })
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

  getCellStyle(row: number, col: number): CellStyle {
    return this.styleStore.getStyle(this.activeSheetId, row, col)
  }

  /** Applies `patch` (per-key: set, or clear via `undefined`) to every cell in `range`. */
  applyStyle(range: CellRangeBounds, patch: CellStyle): void {
    const cells: CellPos[] = []
    for (let row = range.minRow; row <= range.maxRow; row++) {
      for (let col = range.minCol; col <= range.maxCol; col++) {
        cells.push({ row, col })
      }
    }
    const sheetId = this.activeSheetId
    const before = this.styleStore.applyPatch(sheetId, cells, patch)
    const after = cells.map(({ row, col }) => ({ row, col, style: this.styleStore.getStyle(sheetId, row, col) }))
    this.pushMarker({ kind: 'style', sheetId, before, after })
  }

  getMerges(): SerializedMerge[] {
    return this.styleStore.mergesFor(this.activeSheetId)
  }

  findMergeContaining(row: number, col: number): SerializedMerge | undefined {
    return this.styleStore.findMergeContaining(this.activeSheetId, row, col)
  }

  /** No-op (no undo entry) for a single-cell range, or one overlapping an existing merge. */
  mergeRange(range: CellRangeBounds): void {
    if (range.minRow === range.maxRow && range.minCol === range.maxCol) return
    const sheetId = this.activeSheetId
    const before = this.styleStore.mergesFor(sheetId)
    const after = this.styleStore.addMerge(sheetId, {
      minRow: range.minRow,
      minCol: range.minCol,
      maxRow: range.maxRow,
      maxCol: range.maxCol
    })
    if (!after) return
    this.pushMarker({ kind: 'merge', sheetId, before, after })
  }

  /** No-op (no undo entry) if (row, col) isn't inside any merge. */
  unmergeAt(row: number, col: number): void {
    const sheetId = this.activeSheetId
    const before = this.styleStore.mergesFor(sheetId)
    const removed = this.styleStore.removeMergeAt(sheetId, row, col)
    if (!removed) return
    this.pushMarker({ kind: 'merge', sheetId, before, after: this.styleStore.mergesFor(sheetId) })
  }

  getRowHeight(row: number): number {
    return this.dimensionsStore.getRowHeight(this.activeSheetId, row)
  }

  getColWidth(col: number): number {
    return this.dimensionsStore.getColWidth(this.activeSheetId, col)
  }

  /** Highest row/col index with an explicit size override on the active sheet, or -1 if none. */
  maxOverriddenRow(): number {
    return this.dimensionsStore.maxOverriddenRow(this.activeSheetId)
  }

  maxOverriddenCol(): number {
    return this.dimensionsStore.maxOverriddenCol(this.activeSheetId)
  }

  setRowHeight(row: number, height: number): void {
    const sheetId = this.activeSheetId
    const priorEffective = this.dimensionsStore.getRowHeight(sheetId, row)
    const before = this.dimensionsStore.setRowHeight(sheetId, row, height)
    const after = this.dimensionsStore.getRowHeight(sheetId, row)
    if (priorEffective === after) return
    this.pushMarker({ kind: 'dimension', sheetId, axis: 'row', index: row, before, after })
  }

  setColWidth(col: number, width: number): void {
    const sheetId = this.activeSheetId
    const priorEffective = this.dimensionsStore.getColWidth(sheetId, col)
    const before = this.dimensionsStore.setColWidth(sheetId, col, width)
    const after = this.dimensionsStore.getColWidth(sheetId, col)
    if (priorEffective === after) return
    this.pushMarker({ kind: 'dimension', sheetId, axis: 'col', index: col, before, after })
  }

  private captureAux(sheetId: number): AuxSnapshot {
    return {
      styles: this.styleStore.serializeSheet(sheetId),
      merges: this.styleStore.mergesFor(sheetId),
      rowHeights: this.dimensionsStore.serializeRowHeights(sheetId),
      colWidths: this.dimensionsStore.serializeColWidths(sheetId)
    }
  }

  private restoreAux(sheetId: number, snap: AuxSnapshot): void {
    this.styleStore.loadSheetStyles(sheetId, snap.styles)
    this.styleStore.setMerges(sheetId, snap.merges)
    this.dimensionsStore.loadSheet(sheetId, snap.rowHeights, snap.colWidths)
  }

  /** No-op (no undo entry) if `count` isn't positive or hf refuses the operation (e.g. past sheet capacity). */
  insertRows(at: number, count: number): void {
    const sheetId = this.activeSheetId
    if (count <= 0 || !this.hf.isItPossibleToAddRows(sheetId, [at, count])) return
    const before = this.captureAux(sheetId)
    this.hf.addRows(sheetId, [at, count])
    this.styleStore.insertRows(sheetId, at, count)
    this.dimensionsStore.insertRows(sheetId, at, count)
    this.pushMarker({ kind: 'structure', sheetId, before, after: this.captureAux(sheetId) })
  }

  /** No-op (no undo entry) if `count` isn't positive or hf refuses the operation. */
  deleteRows(at: number, count: number): void {
    const sheetId = this.activeSheetId
    if (count <= 0 || !this.hf.isItPossibleToRemoveRows(sheetId, [at, count])) return
    const before = this.captureAux(sheetId)
    this.hf.removeRows(sheetId, [at, count])
    this.styleStore.deleteRows(sheetId, at, count)
    this.dimensionsStore.deleteRows(sheetId, at, count)
    this.pushMarker({ kind: 'structure', sheetId, before, after: this.captureAux(sheetId) })
  }

  /** No-op (no undo entry) if `count` isn't positive or hf refuses the operation (e.g. past sheet capacity). */
  insertCols(at: number, count: number): void {
    const sheetId = this.activeSheetId
    if (count <= 0 || !this.hf.isItPossibleToAddColumns(sheetId, [at, count])) return
    const before = this.captureAux(sheetId)
    this.hf.addColumns(sheetId, [at, count])
    this.styleStore.insertCols(sheetId, at, count)
    this.dimensionsStore.insertCols(sheetId, at, count)
    this.pushMarker({ kind: 'structure', sheetId, before, after: this.captureAux(sheetId) })
  }

  /** No-op (no undo entry) if `count` isn't positive or hf refuses the operation. */
  deleteCols(at: number, count: number): void {
    const sheetId = this.activeSheetId
    if (count <= 0 || !this.hf.isItPossibleToRemoveColumns(sheetId, [at, count])) return
    const before = this.captureAux(sheetId)
    this.hf.removeColumns(sheetId, [at, count])
    this.styleStore.deleteCols(sheetId, at, count)
    this.dimensionsStore.deleteCols(sheetId, at, count)
    this.pushMarker({ kind: 'structure', sheetId, before, after: this.captureAux(sheetId) })
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
      const sheetId = this.hf.getSheetId(name)
      if (sheetId === undefined) throw new Error(`Sheet ${name} has no id`)
      const dense = allSheets[name] ?? []
      const cells: SerializedCell[] = []
      dense.forEach((rowContents, row) => {
        rowContents.forEach((content, col) => {
          if (content === null || content === undefined || content === '') return
          if (content instanceof Date) return // date literals not supported yet
          const canonical = typeof content === 'string' && content.startsWith('=') ? toCanonicalFormula(content) : content
          cells.push({ row, col, content: canonical })
        })
      })
      const styles = this.styleStore.serializeSheet(sheetId)
      const merges = this.styleStore.mergesFor(sheetId)
      const rowHeights = this.dimensionsStore.serializeRowHeights(sheetId)
      const colWidths = this.dimensionsStore.serializeColWidths(sheetId)
      return {
        name,
        cells,
        ...(styles.length > 0 && { styles }),
        ...(merges.length > 0 && { merges }),
        ...(rowHeights.length > 0 && { rowHeights }),
        ...(colWidths.length > 0 && { colWidths })
      }
    })

    const activeSheetName = this.hf.getSheetName(this.activeSheetId)
    const activeSheetIndex = Math.max(0, names.indexOf(activeSheetName ?? names[0]))

    return { formatVersion: 1, sheets, activeSheetIndex }
  }

  /** Replaces the entire engine state with `doc` (open/new-from-file). */
  loadWorkbook(doc: SerializedWorkbook): void {
    this.hf = this.createEngine()
    this.styleStore = new StyleStore()
    this.dimensionsStore = new DimensionsStore()
    this.undoStack = []
    this.redoStack = []
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
          const content =
            typeof cell.content === 'string' && cell.content.startsWith('=')
              ? toDisplayFormula(cell.content)
              : cell.content
          this.hf.setCellContents({ sheet: sheetId, row: cell.row, col: cell.col }, [[content]])
        }
        if (sheet.styles) this.styleStore.loadSheetStyles(sheetId, sheet.styles)
        if (sheet.merges) this.styleStore.setMerges(sheetId, sheet.merges)
        if (sheet.rowHeights || sheet.colWidths) {
          this.dimensionsStore.loadSheet(sheetId, sheet.rowHeights ?? [], sheet.colWidths ?? [])
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
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** No-ops (rather than throwing) when there's nothing to undo -- callers don't need to guard. */
  undo(): CellSnapshot[] {
    const marker = this.undoStack.pop()
    if (!marker) return []
    if (marker.kind === 'content' || marker.kind === 'structure') {
      const changes = this.hf
        .undo()
        .filter((change): change is ExportedCellChange => change instanceof ExportedCellChange)
        .map((change) => this.getCellSnapshot(change.row, change.col))
      if (marker.kind === 'structure') this.restoreAux(marker.sheetId, marker.before)
      this.redoStack.push(marker)
      return changes
    }
    if (marker.kind === 'style') this.styleStore.restore(marker.sheetId, marker.before)
    else if (marker.kind === 'merge') this.styleStore.setMerges(marker.sheetId, marker.before)
    else if (marker.axis === 'row') this.dimensionsStore.restoreRowHeight(marker.sheetId, marker.index, marker.before)
    else this.dimensionsStore.restoreColWidth(marker.sheetId, marker.index, marker.before)
    this.redoStack.push(marker)
    return []
  }

  redo(): CellSnapshot[] {
    const marker = this.redoStack.pop()
    if (!marker) return []
    if (marker.kind === 'content' || marker.kind === 'structure') {
      const changes = this.hf
        .redo()
        .filter((change): change is ExportedCellChange => change instanceof ExportedCellChange)
        .map((change) => this.getCellSnapshot(change.row, change.col))
      if (marker.kind === 'structure') this.restoreAux(marker.sheetId, marker.after)
      this.undoStack.push(marker)
      return changes
    }
    if (marker.kind === 'style') this.styleStore.restore(marker.sheetId, marker.after)
    else if (marker.kind === 'merge') this.styleStore.setMerges(marker.sheetId, marker.after)
    else if (marker.axis === 'row') this.dimensionsStore.restoreRowHeight(marker.sheetId, marker.index, marker.after)
    else this.dimensionsStore.restoreColWidth(marker.sheetId, marker.index, marker.after)
    this.undoStack.push(marker)
    return []
  }

  copyRange(range: CellRangeBounds): void {
    this.hf.copy(this.toSimpleCellRange(range))
  }

  /** hf.cut() alone never registers an undo entry -- only the paste that consumes it does -- so no marker here. */
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
    this.pushMarker({ kind: 'content' })
    return changes
      .filter((change): change is ExportedCellChange => change instanceof ExportedCellChange)
      .map((change) => this.getCellSnapshot(change.row, change.col))
  }

  /** Writes a parsed-TSV block (external paste) starting at (row, col). */
  pasteExternalRows(row: number, col: number, rows: (string | number | boolean)[][]): void {
    let wroteAnyCell = false
    this.hf.batch(() => {
      rows.forEach((rowValues, rOffset) => {
        rowValues.forEach((value, cOffset) => {
          const content = value === '' ? null : value
          this.hf.setCellContents({ sheet: this.activeSheetId, row: row + rOffset, col: col + cOffset }, [[content]])
          wroteAnyCell = true
        })
      })
    })
    // A batch with no writes inside (e.g. an empty paste) registers no hf
    // undo entry either -- skip the marker to keep the two stacks in lockstep.
    if (wroteAnyCell) this.pushMarker({ kind: 'content' })
  }

  private pushMarker(marker: UndoMarker): void {
    this.redoStack = []
    this.undoStack.push(marker)
  }

  private toSimpleCellRange(range: CellRangeBounds) {
    return {
      start: { sheet: this.activeSheetId, row: range.minRow, col: range.minCol },
      end: { sheet: this.activeSheetId, row: range.maxRow, col: range.maxCol }
    }
  }
}
