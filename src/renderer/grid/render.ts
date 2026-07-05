import type { EngineAdapter } from '../engine/engine-adapter'
import { computeVisibleRange, type GridMetrics, type ScrollState, type VisibleRange } from './viewport'
import { cellRect, type CellRect } from './hit-test'
import type { CellPos, NormalizedRange } from './selection'
import type { CellBorders, HorizontalAlign, SerializedMerge, VerticalAlign } from '@shared/model'

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
  drawCellBorders(rc, range)
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
    const y = Math.round(metrics.headerHeight + metrics.rowSizer.offsetOf(row) - scroll.scrollTop) + 0.5
    ctx.moveTo(metrics.headerWidth, y)
    ctx.lineTo(scroll.viewportWidth, y)
  }
  for (let col = range.startCol; col <= range.endCol + 1; col++) {
    const x = Math.round(metrics.headerWidth + metrics.colSizer.offsetOf(col) - scroll.scrollLeft) + 0.5
    ctx.moveTo(x, metrics.headerHeight)
    ctx.lineTo(x, scroll.viewportHeight)
  }
  ctx.stroke()
  ctx.restore()
}

/** Cells covered by a merge that intersects the visible range, keyed "row,col" --
 *  shared by the content and border passes so both skip non-anchor members
 *  the same way (the anchor's cell draws the whole merged span once). */
function visibleMergeMemberCells(engine: EngineAdapter, range: VisibleRange): Map<string, SerializedMerge> {
  const members = new Map<string, SerializedMerge>()
  for (const merge of engine.getMerges()) {
    if (merge.maxRow < range.startRow || merge.minRow > range.endRow) continue
    if (merge.maxCol < range.startCol || merge.minCol > range.endCol) continue
    for (let r = Math.max(merge.minRow, range.startRow); r <= Math.min(merge.maxRow, range.endRow); r++) {
      for (let c = Math.max(merge.minCol, range.startCol); c <= Math.min(merge.maxCol, range.endCol); c++) {
        members.set(`${r},${c}`, merge)
      }
    }
  }
  return members
}

function textXAndAlign(rect: CellRect, hAlign: HorizontalAlign | undefined): { x: number; align: CanvasTextAlign } {
  if (hAlign === 'center') return { x: rect.x + rect.width / 2, align: 'center' }
  if (hAlign === 'right') return { x: rect.x + rect.width - 4, align: 'right' }
  return { x: rect.x + 4, align: 'left' }
}

function textYAndBaseline(rect: CellRect, vAlign: VerticalAlign | undefined): { y: number; baseline: CanvasTextBaseline } {
  if (vAlign === 'top') return { y: rect.y + 2, baseline: 'top' }
  if (vAlign === 'bottom') return { y: rect.y + rect.height - 2, baseline: 'bottom' }
  return { y: rect.y + rect.height / 2, baseline: 'middle' }
}

/** Draws one logical cell (a plain cell, or a merge's full spanning rect) --
 *  background, then text. `isMerged` forces a background fill even with no
 *  custom color, to erase the plain gridlines drawn underneath a merge's span. */
function drawOneCell(rc: RenderContext, anchorRow: number, anchorCol: number, rect: CellRect, isMerged: boolean): void {
  const { ctx, engine } = rc
  const style = engine.getCellStyle(anchorRow, anchorCol)

  if (style.backgroundColor) {
    ctx.fillStyle = style.backgroundColor
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  } else if (isMerged) {
    ctx.fillStyle = COLORS.background
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  }

  const snapshot = engine.getCellSnapshot(anchorRow, anchorCol)
  if (snapshot.value === null && !snapshot.error) return

  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()

  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}13px sans-serif`
  ctx.fillStyle = snapshot.error ? COLORS.errorText : (style.textColor ?? COLORS.cellText)

  const { x, align } = textXAndAlign(rect, style.hAlign)
  const { y, baseline } = textYAndBaseline(rect, style.vAlign)
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.fillText(snapshot.error ?? String(snapshot.value), x, y, rect.width - 8)
  ctx.restore()
}

function drawCellContent(rc: RenderContext, range: VisibleRange): void {
  const { ctx, metrics, scroll, engine } = rc
  ctx.save()
  bodyClip(rc)

  const mergeMembers = visibleMergeMemberCells(engine, range)
  const drawnAnchors = new Set<string>()
  for (const merge of mergeMembers.values()) {
    const anchorKey = `${merge.minRow},${merge.minCol}`
    if (drawnAnchors.has(anchorKey)) continue
    drawnAnchors.add(anchorKey)
    const rect = boundingScreenRect(merge.minRow, merge.minCol, merge.maxRow, merge.maxCol, metrics, scroll)
    drawOneCell(rc, merge.minRow, merge.minCol, rect, true)
  }

  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      if (mergeMembers.has(`${row},${col}`)) continue
      drawOneCell(rc, row, col, cellRect(row, col, metrics, scroll), false)
    }
  }
  ctx.restore()
}

function strokeBorderSide(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string): void {
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function drawBordersForRect(ctx: CanvasRenderingContext2D, rect: CellRect, borders: CellBorders): void {
  ctx.lineWidth = 1.5
  if (borders.top) strokeBorderSide(ctx, rect.x, rect.y + 0.75, rect.x + rect.width, rect.y + 0.75, borders.top.color)
  if (borders.bottom) {
    strokeBorderSide(
      ctx,
      rect.x,
      rect.y + rect.height - 0.75,
      rect.x + rect.width,
      rect.y + rect.height - 0.75,
      borders.bottom.color
    )
  }
  if (borders.left) strokeBorderSide(ctx, rect.x + 0.75, rect.y, rect.x + 0.75, rect.y + rect.height, borders.left.color)
  if (borders.right) {
    strokeBorderSide(
      ctx,
      rect.x + rect.width - 0.75,
      rect.y,
      rect.x + rect.width - 0.75,
      rect.y + rect.height,
      borders.right.color
    )
  }
}

function drawCellBorders(rc: RenderContext, range: VisibleRange): void {
  const { ctx, metrics, scroll, engine } = rc
  ctx.save()
  bodyClip(rc)

  const mergeMembers = visibleMergeMemberCells(engine, range)
  const drawnAnchors = new Set<string>()
  for (const merge of mergeMembers.values()) {
    const anchorKey = `${merge.minRow},${merge.minCol}`
    if (drawnAnchors.has(anchorKey)) continue
    drawnAnchors.add(anchorKey)
    const style = engine.getCellStyle(merge.minRow, merge.minCol)
    if (style.borders) {
      drawBordersForRect(
        ctx,
        boundingScreenRect(merge.minRow, merge.minCol, merge.maxRow, merge.maxCol, metrics, scroll),
        style.borders
      )
    }
  }

  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      if (mergeMembers.has(`${row},${col}`)) continue
      const style = engine.getCellStyle(row, col)
      if (style.borders) drawBordersForRect(ctx, cellRect(row, col, metrics, scroll), style.borders)
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
    const x = metrics.headerWidth + metrics.colSizer.offsetOf(col) - scroll.scrollLeft
    const width = metrics.colSizer.sizeOf(col)
    ctx.fillStyle = col >= sel.minCol && col <= sel.maxCol ? COLORS.headerTextActive : COLORS.headerText
    ctx.fillText(columnLabel(col), x + width / 2, metrics.headerHeight / 2)
  }
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, metrics.headerHeight, metrics.headerWidth, Math.max(0, scroll.viewportHeight - metrics.headerHeight))
  ctx.clip()
  ctx.textAlign = 'right'
  for (let row = range.startRow; row <= range.endRow; row++) {
    const y = metrics.headerHeight + metrics.rowSizer.offsetOf(row) - scroll.scrollTop
    const height = metrics.rowSizer.sizeOf(row)
    ctx.fillStyle = row >= sel.minRow && row <= sel.maxRow ? COLORS.headerTextActive : COLORS.headerText
    ctx.fillText(String(row + 1), metrics.headerWidth - 6, y + height / 2)
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
