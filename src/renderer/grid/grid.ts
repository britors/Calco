import { EngineAdapter, MAX_COLS, MAX_ROWS } from '../engine/engine-adapter'
import type { GridMetrics, ScrollState } from './viewport'
import { hitTest, hitTestColumnHeader, hitTestRowHeader } from './hit-test'
import { Selection } from './selection'
import { computeUsedRegion } from './used-region'
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
  destroy(): void
}

/** Mounts an isolated canvas spreadsheet grid into `container`, backed by `engine`. */
export function mountGrid(container: HTMLElement, engine: EngineAdapter): MountedGrid {
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
      if (e.shiftKey) {
        selection.extendTo(hit.row, hit.col)
      } else {
        selection.moveTo(hit.row, hit.col)
        isDragging = true
        window.addEventListener('mousemove', handleWindowMouseMove)
        window.addEventListener('mouseup', handleWindowMouseUp)
      }
      container.focus()
      scheduleRender()
    }
  }

  function handleDoubleClick(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect()
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top, METRICS, currentScroll())
    if (hit) {
      selection.moveTo(hit.row, hit.col)
      openEditorAt(hit.row, hit.col, null)
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

  function handleKeydown(e: KeyboardEvent): void {
    if (editor.isEditing) return

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      handleSelectAllKey()
      return
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
