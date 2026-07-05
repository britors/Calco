import { EngineAdapter, MAX_COLS, MAX_ROWS } from '../engine/engine-adapter'
import type { GridMetrics, ScrollState } from './viewport'
import { hitTest, hitTestColumnHeader, hitTestRowHeader } from './hit-test'
import { Selection, type NormalizedRange } from './selection'
import { computeUsedRegion } from './used-region'
import { buildHtmlTable, buildTsv, buildValuesMatrix, parseTsv } from './clipboard'
import { render } from './render'
import { EditorOverlay, type EditorCloseResult } from './editor-overlay'

const METRICS: GridMetrics = {
  rowHeight: 24,
  colWidth: 80,
  headerWidth: 48,
  headerHeight: 24
}

export interface MountedGrid {
  /** Forces a redraw -- for callers that mutate the engine outside the grid's own edit flow (e.g. undo/redo). */
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
  sizer.style.width = `${METRICS.headerWidth + MAX_COLS * METRICS.colWidth}px`
  sizer.style.height = `${METRICS.headerHeight + MAX_ROWS * METRICS.rowHeight}px`
  scroller.appendChild(sizer)

  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.pointerEvents = 'auto'

  container.appendChild(scroller)
  container.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  const selection = new Selection(MAX_ROWS - 1, MAX_COLS - 1)
  const editor = new EditorOverlay(container, engine, METRICS, handleEditorClose)

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
      metrics: METRICS,
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
    const top = row * METRICS.rowHeight
    const bottom = top + METRICS.rowHeight
    const left = col * METRICS.colWidth
    const right = left + METRICS.colWidth
    const bodyHeight = container.clientHeight - METRICS.headerHeight
    const bodyWidth = container.clientWidth - METRICS.headerWidth

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
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top, METRICS, currentScroll())
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

  function handlePointerDown(e: MouseEvent): void {
    if (editor.isEditing) editor.commitInPlace()
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const scroll = currentScroll()

    const colHeaderHit = hitTestColumnHeader(x, y, METRICS, scroll)
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

    const rowHeaderHit = hitTestRowHeader(x, y, METRICS, scroll)
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

    const hit = hitTest(x, y, METRICS, scroll)
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
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top, METRICS, currentScroll())
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
  canvas.addEventListener('dblclick', handleDoubleClick)
  canvas.addEventListener('wheel', handleWheel, { passive: false })
  container.addEventListener('keydown', handleKeydown)

  resizeCanvasToContainer()
  scheduleRender()

  return {
    refresh(): void {
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
      canvas.removeEventListener('dblclick', handleDoubleClick)
      canvas.removeEventListener('wheel', handleWheel)
      container.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
      editor.destroy()
      scroller.remove()
      canvas.remove()
    }
  }
}
