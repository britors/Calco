import type { EngineAdapter } from '../engine/engine-adapter'
import { computeVisibleRange, type GridMetrics, type ScrollState, type VisibleRange } from './viewport'
import { cellRect } from './hit-test'
import type { CellPos, NormalizedRange } from './selection'

const COLORS = {
  background: '#ffffff',
  gridline: '#e0e0e0',
  headerBg: '#f3f3f3',
  headerBorder: '#c8c8c8',
  headerText: '#333333',
  headerTextActive: '#1a73e8',
  cellText: '#1a1a1a',
  errorText: '#c0392b',
  selectionFill: 'rgba(26, 115, 232, 0.08)',
  selectionBorder: '#1a73e8'
} as const

/** 0 -> "A", 25 -> "Z", 26 -> "AA", ... */
export function columnLabel(col: number): string {
  let n = col + 1
  let label = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

export interface RenderSelection {
  normalized: NormalizedRange
  activeCell: CellPos
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D
  metrics: GridMetrics
  scroll: ScrollState
  engine: EngineAdapter
  selection: RenderSelection
  dpr: number
  maxRow: number
  maxCol: number
}

export function render(rc: RenderContext): void {
  const { ctx, metrics, scroll, dpr } = rc

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.textBaseline = 'middle'
  ctx.font = '13px sans-serif'

  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, scroll.viewportWidth, scroll.viewportHeight)

  const range = computeVisibleRange(metrics, scroll, rc.maxRow, rc.maxCol)

  drawBodyGridlines(rc, range)
  drawCellContent(rc, range)
  drawSelection(rc, range)
  drawHeaders(rc, range)

  ctx.restore()
}

function bodyClip(rc: RenderContext): void {
  const { ctx, metrics, scroll } = rc
  ctx.beginPath()
  ctx.rect(
    metrics.headerWidth,
    metrics.headerHeight,
    Math.max(0, scroll.viewportWidth - metrics.headerWidth),
    Math.max(0, scroll.viewportHeight - metrics.headerHeight)
  )
  ctx.clip()
}

function drawBodyGridlines(rc: RenderContext, range: VisibleRange): void {
  const { ctx, metrics, scroll } = rc
  ctx.save()
  bodyClip(rc)
  ctx.strokeStyle = COLORS.gridline
  ctx.lineWidth = 1
  ctx.beginPath()

  for (let row = range.startRow; row <= range.endRow + 1; row++) {
    const y = Math.round(metrics.headerHeight + row * metrics.rowHeight - scroll.scrollTop) + 0.5
    ctx.moveTo(metrics.headerWidth, y)
    ctx.lineTo(scroll.viewportWidth, y)
  }
  for (let col = range.startCol; col <= range.endCol + 1; col++) {
    const x = Math.round(metrics.headerWidth + col * metrics.colWidth - scroll.scrollLeft) + 0.5
    ctx.moveTo(x, metrics.headerHeight)
    ctx.lineTo(x, scroll.viewportHeight)
  }
  ctx.stroke()
  ctx.restore()
}

function drawCellContent(rc: RenderContext, range: VisibleRange): void {
  const { ctx, metrics, scroll, engine } = rc
  ctx.save()
  bodyClip(rc)

  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      const snapshot = engine.getCellSnapshot(row, col)
      if (snapshot.error) {
        ctx.fillStyle = COLORS.errorText
      } else if (snapshot.value === null) {
        continue
      } else {
        ctx.fillStyle = COLORS.cellText
      }
      const rect = cellRect(row, col, metrics, scroll)
      const text = snapshot.error ?? String(snapshot.value)
      ctx.save()
      ctx.beginPath()
      ctx.rect(rect.x, rect.y, rect.width, rect.height)
      ctx.clip()
      ctx.fillText(text, rect.x + 4, rect.y + rect.height / 2, rect.width - 8)
      ctx.restore()
    }
  }
  ctx.restore()
}

function boundingScreenRect(
  minRow: number,
  minCol: number,
  maxRow: number,
  maxCol: number,
  metrics: GridMetrics,
  scroll: Pick<ScrollState, 'scrollTop' | 'scrollLeft'>
) {
  const topLeft = cellRect(minRow, minCol, metrics, scroll)
  const bottomRight = cellRect(maxRow, maxCol, metrics, scroll)
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x + bottomRight.width - topLeft.x,
    height: bottomRight.y + bottomRight.height - topLeft.y
  }
}

function drawSelection(rc: RenderContext, range: VisibleRange): void {
  const { ctx, metrics, scroll, selection } = rc
  const sel = selection.normalized
  const isRange = sel.minRow !== sel.maxRow || sel.minCol !== sel.maxCol

  ctx.save()
  bodyClip(rc)

  if (isRange) {
    const visMinRow = Math.max(sel.minRow, range.startRow)
    const visMaxRow = Math.min(sel.maxRow, range.endRow)
    const visMinCol = Math.max(sel.minCol, range.startCol)
    const visMaxCol = Math.min(sel.maxCol, range.endCol)

    if (visMinRow <= visMaxRow && visMinCol <= visMaxCol) {
      const fillRect = boundingScreenRect(visMinRow, visMinCol, visMaxRow, visMaxCol, metrics, scroll)
      ctx.fillStyle = COLORS.selectionFill
      ctx.fillRect(fillRect.x, fillRect.y, fillRect.width, fillRect.height)

      // Exclude the active cell from the tint, matching Excel's look.
      const { row: activeRow, col: activeCol } = selection.activeCell
      if (activeRow >= visMinRow && activeRow <= visMaxRow && activeCol >= visMinCol && activeCol <= visMaxCol) {
        const activeRect = cellRect(activeRow, activeCol, metrics, scroll)
        ctx.fillStyle = COLORS.background
        ctx.fillRect(activeRect.x, activeRect.y, activeRect.width, activeRect.height)
      }
    }

    const outer = boundingScreenRect(sel.minRow, sel.minCol, sel.maxRow, sel.maxCol, metrics, scroll)
    ctx.strokeStyle = COLORS.selectionBorder
    ctx.lineWidth = 2
    ctx.strokeRect(outer.x + 1, outer.y + 1, outer.width - 2, outer.height - 2)

    const activeRect = cellRect(selection.activeCell.row, selection.activeCell.col, metrics, scroll)
    ctx.lineWidth = 1
    ctx.strokeRect(activeRect.x + 1, activeRect.y + 1, activeRect.width - 2, activeRect.height - 2)
  } else {
    const rect = cellRect(selection.activeCell.row, selection.activeCell.col, metrics, scroll)
    ctx.fillStyle = COLORS.selectionFill
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.strokeStyle = COLORS.selectionBorder
    ctx.lineWidth = 2
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2)
  }

  ctx.restore()
}

function drawHeaders(rc: RenderContext, range: VisibleRange): void {
  const { ctx, metrics, scroll, selection } = rc
  const sel = selection.normalized

  // Corner + column header strip.
  ctx.fillStyle = COLORS.headerBg
  ctx.fillRect(0, 0, scroll.viewportWidth, metrics.headerHeight)
  ctx.fillRect(0, 0, metrics.headerWidth, scroll.viewportHeight)

  ctx.save()
  ctx.beginPath()
  ctx.rect(metrics.headerWidth, 0, Math.max(0, scroll.viewportWidth - metrics.headerWidth), metrics.headerHeight)
  ctx.clip()
  ctx.textAlign = 'center'
  for (let col = range.startCol; col <= range.endCol; col++) {
    const x = metrics.headerWidth + col * metrics.colWidth - scroll.scrollLeft
    ctx.fillStyle = col >= sel.minCol && col <= sel.maxCol ? COLORS.headerTextActive : COLORS.headerText
    ctx.fillText(columnLabel(col), x + metrics.colWidth / 2, metrics.headerHeight / 2)
  }
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, metrics.headerHeight, metrics.headerWidth, Math.max(0, scroll.viewportHeight - metrics.headerHeight))
  ctx.clip()
  ctx.textAlign = 'right'
  for (let row = range.startRow; row <= range.endRow; row++) {
    const y = metrics.headerHeight + row * metrics.rowHeight - scroll.scrollTop
    ctx.fillStyle = row >= sel.minRow && row <= sel.maxRow ? COLORS.headerTextActive : COLORS.headerText
    ctx.fillText(String(row + 1), metrics.headerWidth - 6, y + metrics.rowHeight / 2)
  }
  ctx.restore()

  ctx.strokeStyle = COLORS.headerBorder
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, metrics.headerHeight + 0.5)
  ctx.lineTo(scroll.viewportWidth, metrics.headerHeight + 0.5)
  ctx.moveTo(metrics.headerWidth + 0.5, 0)
  ctx.lineTo(metrics.headerWidth + 0.5, scroll.viewportHeight)
  ctx.stroke()
}
