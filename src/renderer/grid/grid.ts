import { EngineAdapter, MAX_COLS, MAX_ROWS } from '../engine/engine-adapter'
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../engine/dimensions-store'
import { AxisSizer, type GridMetrics, type ScrollState } from './viewport'
import {
  hitTest,
  hitTestColumnBoundary,
  hitTestColumnHeader,
  hitTestRowBoundary,
  hitTestRowHeader
} from './hit-test'
import { Selection, type NormalizedRange } from './selection'
import { computeUsedRegion } from './used-region'
import { buildHtmlTable, buildTsv, buildValuesMatrix, parseTsv } from './clipboard'
import { render } from './render'
import { EditorOverlay, type EditorCloseResult } from './editor-overlay'

const HEADER_WIDTH = 48
const HEADER_HEIGHT = 24
const RESIZE_HANDLE_TOLERANCE = 4 // px on either side of a header boundary that grabs a resize drag
const AUTOFIT_PADDING = 12
const AUTOFIT_MAX_ROWS_SCANNED = 2000 // bounded content scan for column autofit -- sheets can nominally hold 100,000 rows

export interface MountedGrid {
  /** Forces a redraw -- for callers that mutate the engine outside the grid's own edit flow (e.g. undo/redo, sheet switch). */
  refresh(): void
  /** Selects and scrolls to (row, col) -- same effect as clicking that cell (e.g. jumping to a find-match). */
  selectCell(row: number, col: number): void
  /** The current selection range -- for callers applying an action (e.g. a toolbar button) to "whatever's selected". */
  getSelectionRange(): NormalizedRange
  destroy(): void
}

export interface MountGridOptions {
  /** Fires on every render -- a superset of "the active cell or its content may have changed" (also fires on pure scroll/resize), which is simpler and more robust than instrumenting every individual selection-mutating call site. */
  onActiveCellChange?: (row: number, col: number) => void
}

/** Mounts an isolated canvas spreadsheet grid into `container`, backed by `engine`. */
export function mountGrid(container: HTMLElement, engine: EngineAdapter, options: MountGridOptions = {}): MountedGrid {
  // Only impose a positioning context if the caller hasn't already given the
  // container one (e.g. `position: absolute; inset: 0` to fill a parent) --
  // overwriting it unconditionally would collapse a caller-sized container.
  if (window.getComputedStyle(container).position === 'static') {
    container.style.position = 'relative'
  }
  container.style.overflow = 'hidden'
  container.tabIndex = 0
  container.style.outline = 'none'

  const scroller = document.createElement('div')
  scroller.style.position = 'absolute'
  scroller.style.inset = '0'
  scroller.style.overflow = 'auto'

  const sizer = document.createElement('div')
  scroller.appendChild(sizer)

  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.pointerEvents = 'auto'

  const resizeLine = document.createElement('div')
  resizeLine.style.position = 'absolute'
  resizeLine.style.background = '#1a73e8'
  resizeLine.style.display = 'none'
  resizeLine.style.zIndex = '5'
  resizeLine.style.pointerEvents = 'none'

  container.appendChild(scroller)
  container.appendChild(canvas)
  container.appendChild(resizeLine)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  // Rows/columns are mostly a uniform default size with a sparse set of
  // per-index overrides (DimensionsStore, via the engine) -- these sizers
  // turn that into cumulative pixel offsets. Rebuilt (cheap: bounded by the
  // highest overridden index, not sheet capacity) whenever an override
  // changes or the active sheet/document does.
  const rowSizer = new AxisSizer(DEFAULT_ROW_HEIGHT, (row) => engine.getRowHeight(row))
  const colSizer = new AxisSizer(DEFAULT_COL_WIDTH, (col) => engine.getColWidth(col))
  const metrics: GridMetrics = { headerWidth: HEADER_WIDTH, headerHeight: HEADER_HEIGHT, rowSizer, colSizer }

  function rebuildSizers(): void {
    rowSizer.rebuild(engine.maxOverriddenRow() + 1)
    colSizer.rebuild(engine.maxOverriddenCol() + 1)
  }

  function updateSizerDivSize(): void {
    sizer.style.width = `${metrics.headerWidth + colSizer.totalSize(MAX_COLS)}px`
    sizer.style.height = `${metrics.headerHeight + rowSizer.totalSize(MAX_ROWS)}px`
  }

  rebuildSizers()
  updateSizerDivSize()

  const selection = new Selection(MAX_ROWS - 1, MAX_COLS - 1)
  const editor = new EditorOverlay(container, engine, metrics, handleEditorClose)

  // Text last written to the OS clipboard by *this* app -- lets paste tell an
  // internal copy/cut apart from external data (e.g. copied from real Excel)
  // without a fragile "was the last action ours" flag: if the OS clipboard
  // still holds exactly what we wrote, it's safe to assume it's still ours.
  let lastInternalClipboardText: string | null = null
  let lastCopiedValues: (string | number | boolean)[][] | null = null

  let renderScheduled = false
  function scheduleRender(): void {
    if (renderScheduled) return
    renderScheduled = true
    requestAnimationFrame(() => {
      renderScheduled = false
      draw()
    })
  }

  function currentScroll(): ScrollState {
    return {
      scrollTop: scroller.scrollTop,
      scrollLeft: scroller.scrollLeft,
      viewportWidth: container.clientWidth,
      viewportHeight: container.clientHeight
    }
  }

  function resizeCanvasToContainer(): void {
    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const height = container.clientHeight
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }

  function draw(): void {
    if (!ctx) return
    render({
      ctx,
      metrics,
      scroll: currentScroll(),
      engine,
      selection: { normalized: selection.normalized, activeCell: selection.activeCell },
      dpr: window.devicePixelRatio || 1,
      maxRow: MAX_ROWS - 1,
      maxCol: MAX_COLS - 1
    })
    options.onActiveCellChange?.(selection.activeCell.row, selection.activeCell.col)
  }

  function ensureVisible(row: number, col: number): void {
    const top = rowSizer.offsetOf(row)
    const bottom = top + rowSizer.sizeOf(row)
    const left = colSizer.offsetOf(col)
    const right = left + colSizer.sizeOf(col)
    const bodyHeight = container.clientHeight - metrics.headerHeight
    const bodyWidth = container.clientWidth - metrics.headerWidth

    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (bottom > scroller.scrollTop + bodyHeight) scroller.scrollTop = bottom - bodyHeight

    if (left < scroller.scrollLeft) scroller.scrollLeft = left
    else if (right > scroller.scrollLeft + bodyWidth) scroller.scrollLeft = right - bodyWidth
  }

  function openEditorAt(row: number, col: number, seed: string | null): void {
    const initialValue = seed ?? engine.getCellSnapshot(row, col).raw
    editor.open(row, col, currentScroll(), initialValue, seed === null)
    scheduleRender()
  }

  function handleEditorClose(result: EditorCloseResult): void {
    if (result.committed) {
      selection.moveBy(result.dRow, result.dCol)
      ensureVisible(selection.activeCell.row, selection.activeCell.col)
    }
    container.focus()
    scheduleRender()
  }

  let isDragging = false

  function handleWindowMouseMove(e: MouseEvent): void {
    if (!isDragging) return
    const rect = canvas.getBoundingClientRect()
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top, metrics, currentScroll())
    if (hit) {
      selection.extendTo(hit.row, hit.col)
      scheduleRender()
    }
  }

  function handleWindowMouseUp(): void {
    isDragging = false
    window.removeEventListener('mousemove', handleWindowMouseMove)
    window.removeEventListener('mouseup', handleWindowMouseUp)
  }

  // --- Column/row header-boundary resize drag -----------------------------
  // A live "ghost" line follows the pointer; the actual engine resize (and
  // its single undo entry) only commits on mouseup, so dragging doesn't spam
  // undo history with one step per mousemove.
  interface ResizeDrag {
    axis: 'row' | 'col'
    index: number
    startClientPos: number
    startSize: number
  }
  let resizeDrag: ResizeDrag | null = null

  function showResizeLine(axis: 'row' | 'col', pos: number): void {
    resizeLine.style.display = 'block'
    if (axis === 'col') {
      resizeLine.style.top = '0'
      resizeLine.style.bottom = '0'
      resizeLine.style.left = `${pos}px`
      resizeLine.style.width = '2px'
      resizeLine.style.height = ''
    } else {
      resizeLine.style.left = '0'
      resizeLine.style.right = '0'
      resizeLine.style.top = `${pos}px`
      resizeLine.style.height = '2px'
      resizeLine.style.width = ''
    }
  }

  function hideResizeLine(): void {
    resizeLine.style.display = 'none'
  }

  function startResizeDrag(axis: 'row' | 'col', index: number, clientPos: number): void {
    const startSize = axis === 'col' ? colSizer.sizeOf(index) : rowSizer.sizeOf(index)
    resizeDrag = { axis, index, startClientPos: clientPos, startSize }
    const rect = canvas.getBoundingClientRect()
    const linePos = axis === 'col' ? clientPos - rect.left : clientPos - rect.top
    showResizeLine(axis, linePos)
    window.addEventListener('mousemove', handleResizeDragMove)
    window.addEventListener('mouseup', handleResizeDragEnd)
  }

  function handleResizeDragMove(e: MouseEvent): void {
    if (!resizeDrag) return
    const rect = canvas.getBoundingClientRect()
    const clientPos = resizeDrag.axis === 'col' ? e.clientX : e.clientY
    const linePos = clientPos - (resizeDrag.axis === 'col' ? rect.left : rect.top)
    showResizeLine(resizeDrag.axis, Math.max(resizeDrag.axis === 'col' ? metrics.headerWidth : metrics.headerHeight, linePos))
  }

  function handleResizeDragEnd(e: MouseEvent): void {
    if (!resizeDrag) return
    const { axis, index, startClientPos, startSize } = resizeDrag
    const clientPos = axis === 'col' ? e.clientX : e.clientY
    const newSize = startSize + (clientPos - startClientPos)
    if (axis === 'col') engine.setColWidth(index, newSize)
    else engine.setRowHeight(index, newSize)

    resizeDrag = null
    hideResizeLine()
    window.removeEventListener('mousemove', handleResizeDragMove)
    window.removeEventListener('mouseup', handleResizeDragEnd)
    rebuildSizers()
    updateSizerDivSize()
    scheduleRender()
  }

  function autofitColumn(col: number): void {
    if (!ctx) return
    ctx.save()
    ctx.font = '13px sans-serif'
    let maxWidth = DEFAULT_COL_WIDTH
    const rowsToScan = Math.min(engine.getSheetDimensions().rows, AUTOFIT_MAX_ROWS_SCANNED)
    for (let row = 0; row < rowsToScan; row++) {
      const snapshot = engine.getCellSnapshot(row, col)
      if (snapshot.value === null && !snapshot.error) continue
      const text = snapshot.error ?? String(snapshot.value)
      const width = ctx.measureText(text).width + AUTOFIT_PADDING
      if (width > maxWidth) maxWidth = width
    }
    ctx.restore()
    engine.setColWidth(col, maxWidth)
    rebuildSizers()
    updateSizerDivSize()
    scheduleRender()
  }

  function autofitRow(row: number): void {
    // No text-wrap or per-cell font-size yet, so content never needs more
    // than the default line height -- "autofit" is really "reset to default".
    engine.setRowHeight(row, DEFAULT_ROW_HEIGHT)
    rebuildSizers()
    updateSizerDivSize()
    scheduleRender()
  }

  function handleCanvasHoverMove(e: MouseEvent): void {
    if (isDragging || resizeDrag) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const scroll = currentScroll()
    if (hitTestColumnBoundary(x, y, metrics, scroll, RESIZE_HANDLE_TOLERANCE) !== null) {
      canvas.style.cursor = 'col-resize'
    } else if (hitTestRowBoundary(x, y, metrics, scroll, RESIZE_HANDLE_TOLERANCE) !== null) {
      canvas.style.cursor = 'row-resize'
    } else {
      canvas.style.cursor = 'default'
    }
  }

  function handlePointerDown(e: MouseEvent): void {
    if (editor.isEditing) editor.commitInPlace()
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const scroll = currentScroll()

    const colBoundary = hitTestColumnBoundary(x, y, metrics, scroll, RESIZE_HANDLE_TOLERANCE)
    if (colBoundary !== null) {
      startResizeDrag('col', colBoundary, e.clientX)
      return
    }
    const rowBoundary = hitTestRowBoundary(x, y, metrics, scroll, RESIZE_HANDLE_TOLERANCE)
    if (rowBoundary !== null) {
      startResizeDrag('row', rowBoundary, e.clientY)
      return
    }

    const colHeaderHit = hitTestColumnHeader(x, y, metrics, scroll)
    if (colHeaderHit !== null) {
      if (e.shiftKey) {
        const anchorCol = selection.current.anchor.col
        selection.selectRange(
          0,
          Math.min(anchorCol, colHeaderHit),
          MAX_ROWS - 1,
          Math.max(anchorCol, colHeaderHit)
        )
      } else {
        selection.selectColumn(colHeaderHit)
      }
      container.focus()
      scheduleRender()
      return
    }

    const rowHeaderHit = hitTestRowHeader(x, y, metrics, scroll)
    if (rowHeaderHit !== null) {
      if (e.shiftKey) {
        const anchorRow = selection.current.anchor.row
        selection.selectRange(
          Math.min(anchorRow, rowHeaderHit),
          0,
          Math.max(anchorRow, rowHeaderHit),
          MAX_COLS - 1
        )
      } else {
        selection.selectRow(rowHeaderHit)
      }
      container.focus()
      scheduleRender()
      return
    }

    const hit = hitTest(x, y, metrics, scroll)
    if (hit) {
      const target = mergeAnchorOf(hit.row, hit.col)
      if (e.shiftKey) {
        selection.extendTo(target.row, target.col)
      } else {
        selection.moveTo(target.row, target.col)
        isDragging = true
        window.addEventListener('mousemove', handleWindowMouseMove)
        window.addEventListener('mouseup', handleWindowMouseUp)
      }
      container.focus()
      scheduleRender()
    }
  }

  /** Clicking anywhere inside a merged range selects/edits its top-left anchor cell. */
  function mergeAnchorOf(row: number, col: number): { row: number; col: number } {
    const merge = engine.findMergeContaining(row, col)
    return merge ? { row: merge.minRow, col: merge.minCol } : { row, col }
  }

  function handleDoubleClick(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const scroll = currentScroll()

    const colBoundary = hitTestColumnBoundary(x, y, metrics, scroll, RESIZE_HANDLE_TOLERANCE)
    if (colBoundary !== null) {
      autofitColumn(colBoundary)
      return
    }
    const rowBoundary = hitTestRowBoundary(x, y, metrics, scroll, RESIZE_HANDLE_TOLERANCE)
    if (rowBoundary !== null) {
      autofitRow(rowBoundary)
      return
    }

    const hit = hitTest(x, y, metrics, scroll)
    if (hit) {
      const target = mergeAnchorOf(hit.row, hit.col)
      selection.moveTo(target.row, target.col)
      openEditorAt(target.row, target.col, null)
    }
  }

  function isPrintableKey(e: KeyboardEvent): boolean {
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
  }

  function moveSelection(dRow: number, dCol: number): void {
    selection.moveBy(dRow, dCol)
    ensureVisible(selection.activeCell.row, selection.activeCell.col)
    scheduleRender()
  }

  function extendSelection(dRow: number, dCol: number): void {
    selection.extendBy(dRow, dCol)
    const focus = selection.current.focus
    ensureVisible(focus.row, focus.col)
    scheduleRender()
  }

  function handleSelectAllKey(): void {
    const { row, col } = selection.activeCell
    const used = computeUsedRegion(engine, row, col)
    selection.selectAllProgressive(used)
    scheduleRender()
  }

  async function handleCopy(): Promise<void> {
    const range = selection.normalized
    engine.copyRange(range)
    lastCopiedValues = buildValuesMatrix(engine, range)
    const tsv = buildTsv(engine, range)
    lastInternalClipboardText = tsv
    await window.calco.clipboard.writeHtml(buildHtmlTable(engine, range), tsv)
  }

  async function handleCut(): Promise<void> {
    const range = selection.normalized
    engine.cutRange(range)
    lastCopiedValues = buildValuesMatrix(engine, range)
    const tsv = buildTsv(engine, range)
    lastInternalClipboardText = tsv
    await window.calco.clipboard.writeHtml(buildHtmlTable(engine, range), tsv)
  }

  async function handlePaste(valuesOnly: boolean): Promise<void> {
    const text = await window.calco.clipboard.readText()
    const { row, col } = selection.activeCell
    const isInternal = text === lastInternalClipboardText && !engine.isClipboardEmpty()

    if (isInternal && !valuesOnly) {
      engine.pasteAt(row, col)
    } else if (isInternal && valuesOnly && lastCopiedValues) {
      engine.pasteExternalRows(row, col, lastCopiedValues)
    } else {
      engine.pasteExternalRows(row, col, parseTsv(text))
    }
    ensureVisible(row, col)
    scheduleRender()
  }

  function handleCancelClipboard(): void {
    if (engine.isClipboardEmpty()) return
    engine.clearClipboard()
    lastInternalClipboardText = null
    lastCopiedValues = null
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (editor.isEditing) return

    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase()
      if (key === 'a') {
        e.preventDefault()
        handleSelectAllKey()
        return
      }
      if (key === 'c') {
        e.preventDefault()
        void handleCopy()
        return
      }
      if (key === 'x') {
        e.preventDefault()
        void handleCut()
        return
      }
      if (key === 'v') {
        e.preventDefault()
        void handlePaste(e.shiftKey)
        return
      }
    }

    const { row, col } = selection.activeCell
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        if (e.shiftKey) extendSelection(-1, 0)
        else moveSelection(-1, 0)
        return
      case 'ArrowDown':
        e.preventDefault()
        if (e.shiftKey) extendSelection(1, 0)
        else moveSelection(1, 0)
        return
      case 'ArrowLeft':
        e.preventDefault()
        if (e.shiftKey) extendSelection(0, -1)
        else moveSelection(0, -1)
        return
      case 'ArrowRight':
        e.preventDefault()
        if (e.shiftKey) extendSelection(0, 1)
        else moveSelection(0, 1)
        return
      case 'Enter':
        e.preventDefault()
        moveSelection(1, 0)
        return
      case 'Tab':
        e.preventDefault()
        moveSelection(0, e.shiftKey ? -1 : 1)
        return
      case 'F2':
        e.preventDefault()
        openEditorAt(row, col, null)
        return
      case 'Escape':
        handleCancelClipboard()
        return
      default:
        if (isPrintableKey(e)) openEditorAt(row, col, e.key)
    }
  }

  function handleScroll(): void {
    editor.reposition(currentScroll())
    scheduleRender()
  }

  function handleWheel(e: WheelEvent): void {
    e.preventDefault()
    scroller.scrollTop += e.deltaY
    scroller.scrollLeft += e.deltaX
  }

  const resizeObserver = new ResizeObserver(() => {
    resizeCanvasToContainer()
    scheduleRender()
  })
  resizeObserver.observe(container)

  scroller.addEventListener('scroll', handleScroll)
  canvas.addEventListener('mousedown', handlePointerDown)
  canvas.addEventListener('mousemove', handleCanvasHoverMove)
  canvas.addEventListener('dblclick', handleDoubleClick)
  canvas.addEventListener('wheel', handleWheel, { passive: false })
  container.addEventListener('keydown', handleKeydown)

  resizeCanvasToContainer()
  scheduleRender()

  return {
    refresh(): void {
      rebuildSizers()
      updateSizerDivSize()
      scheduleRender()
    },
    selectCell(row: number, col: number): void {
      selection.moveTo(row, col)
      ensureVisible(row, col)
      scheduleRender()
    },
    getSelectionRange(): NormalizedRange {
      return selection.normalized
    },
    destroy(): void {
      resizeObserver.disconnect()
      scroller.removeEventListener('scroll', handleScroll)
      canvas.removeEventListener('mousedown', handlePointerDown)
      canvas.removeEventListener('mousemove', handleCanvasHoverMove)
      canvas.removeEventListener('dblclick', handleDoubleClick)
      canvas.removeEventListener('wheel', handleWheel)
      container.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
      window.removeEventListener('mousemove', handleResizeDragMove)
      window.removeEventListener('mouseup', handleResizeDragEnd)
      editor.destroy()
      scroller.remove()
      canvas.remove()
      resizeLine.remove()
    }
  }
}
