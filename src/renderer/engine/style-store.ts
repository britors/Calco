import type { CellStyle, SerializedMerge, SerializedStyledCell } from '@shared/model'

export interface CellPos {
  row: number
  col: number
}

export interface StyleSnapshotEntry {
  row: number
  col: number
  style: CellStyle
}

function key(row: number, col: number): string {
  return `${row},${col}`
}

/** Strips undefined-valued keys (and an empty borders object) so two styles
 *  that differ only by "explicitly cleared" vs "never set" compare equal,
 *  and so a style that's been patched back to nothing gets dropped from the
 *  sparse map instead of lingering as `{}`. */
function normalize(style: CellStyle): CellStyle | undefined {
  const out: CellStyle = {}
  if (style.bold !== undefined) out.bold = style.bold
  if (style.italic !== undefined) out.italic = style.italic
  if (style.textColor !== undefined) out.textColor = style.textColor
  if (style.backgroundColor !== undefined) out.backgroundColor = style.backgroundColor
  if (style.hAlign !== undefined) out.hAlign = style.hAlign
  if (style.vAlign !== undefined) out.vAlign = style.vAlign
  if (style.borders) {
    const borders = {
      ...(style.borders.top && { top: style.borders.top }),
      ...(style.borders.right && { right: style.borders.right }),
      ...(style.borders.bottom && { bottom: style.borders.bottom }),
      ...(style.borders.left && { left: style.borders.left })
    }
    if (Object.keys(borders).length > 0) out.borders = borders
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Shallow-merges `patch` onto `prev`; a key explicitly set to `undefined` in
 *  `patch` clears it (rather than being ignored, which is JS's normal spread
 *  behavior for `undefined` values landing after the base). `borders` merges
 *  one level deeper (per-side), same clearing rule. */
function applyPatchToStyle(prev: CellStyle, patch: CellStyle): CellStyle {
  const next: CellStyle = { ...prev }
  for (const k of Object.keys(patch) as (keyof CellStyle)[]) {
    if (k === 'borders') continue
    const value = patch[k]
    if (value === undefined) delete next[k]
    else (next as Record<string, unknown>)[k] = value
  }
  if ('borders' in patch) {
    const prevBorders = prev.borders ?? {}
    const patchBorders = patch.borders ?? {}
    const mergedBorders = { ...prevBorders }
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (side in patchBorders) {
        const value = patchBorders[side]
        if (value === undefined) delete mergedBorders[side]
        else mergedBorders[side] = value
      }
    }
    next.borders = mergedBorders
  }
  return next
}

/** Sparse per-sheet cell styles + merged ranges. Presentation-only state that
 *  HyperFormula knows nothing about; kept alongside it and reset/reloaded in
 *  lockstep with the engine (new document, load, sheet removal). */
export class StyleStore {
  private stylesBySheet = new Map<number, Map<string, CellStyle>>()
  private mergesBySheet = new Map<number, SerializedMerge[]>()

  private stylesFor(sheetId: number): Map<string, CellStyle> {
    let map = this.stylesBySheet.get(sheetId)
    if (!map) {
      map = new Map()
      this.stylesBySheet.set(sheetId, map)
    }
    return map
  }

  getStyle(sheetId: number, row: number, col: number): CellStyle {
    return this.stylesFor(sheetId).get(key(row, col)) ?? {}
  }

  /** Applies `patch` to every cell in `cells`, returning each cell's prior
   *  style (for an undo entry) -- callers snapshot the return value as
   *  `before`, then can call `restore` with it to revert. */
  applyPatch(sheetId: number, cells: CellPos[], patch: CellStyle): StyleSnapshotEntry[] {
    const map = this.stylesFor(sheetId)
    const before: StyleSnapshotEntry[] = []
    for (const { row, col } of cells) {
      const k = key(row, col)
      const prev = map.get(k) ?? {}
      before.push({ row, col, style: prev })
      const merged = normalize(applyPatchToStyle(prev, patch))
      if (merged) map.set(k, merged)
      else map.delete(k)
    }
    return before
  }

  /** Restores an exact snapshot of (row, col, style) entries -- used by undo/redo. */
  restore(sheetId: number, entries: StyleSnapshotEntry[]): void {
    const map = this.stylesFor(sheetId)
    for (const { row, col, style } of entries) {
      const k = key(row, col)
      const normalized = normalize(style)
      if (normalized) map.set(k, normalized)
      else map.delete(k)
    }
  }

  removeSheet(sheetId: number): void {
    this.stylesBySheet.delete(sheetId)
    this.mergesBySheet.delete(sheetId)
  }

  serializeSheet(sheetId: number): SerializedStyledCell[] {
    const map = this.stylesBySheet.get(sheetId)
    if (!map) return []
    const out: SerializedStyledCell[] = []
    for (const [k, style] of map) {
      const [row, col] = k.split(',').map(Number)
      out.push({ row, col, style })
    }
    return out
  }

  loadSheetStyles(sheetId: number, styles: SerializedStyledCell[]): void {
    const map = this.stylesFor(sheetId)
    map.clear()
    for (const { row, col, style } of styles) {
      const normalized = normalize(style)
      if (normalized) map.set(key(row, col), normalized)
    }
  }

  mergesFor(sheetId: number): SerializedMerge[] {
    return this.mergesBySheet.get(sheetId) ?? []
  }

  setMerges(sheetId: number, merges: SerializedMerge[]): void {
    this.mergesBySheet.set(sheetId, merges)
  }

  findMergeContaining(sheetId: number, row: number, col: number): SerializedMerge | undefined {
    return this.mergesFor(sheetId).find(
      (m) => row >= m.minRow && row <= m.maxRow && col >= m.minCol && col <= m.maxCol
    )
  }

  private overlaps(a: SerializedMerge, b: SerializedMerge): boolean {
    return a.minRow <= b.maxRow && a.maxRow >= b.minRow && a.minCol <= b.maxCol && a.maxCol >= b.minCol
  }

  /** No-ops (returns null) if `merge` overlaps an existing merge on the sheet. */
  addMerge(sheetId: number, merge: SerializedMerge): SerializedMerge[] | null {
    const existing = this.mergesFor(sheetId)
    if (existing.some((m) => this.overlaps(m, merge))) return null
    const next = [...existing, merge]
    this.mergesBySheet.set(sheetId, next)
    return next
  }

  /** Removes the merge containing (row, col), if any. Returns the removed merge, or undefined. */
  removeMergeAt(sheetId: number, row: number, col: number): SerializedMerge | undefined {
    const existing = this.mergesFor(sheetId)
    const found = existing.find((m) => row >= m.minRow && row <= m.maxRow && col >= m.minCol && col <= m.maxCol)
    if (!found) return undefined
    this.mergesBySheet.set(
      sheetId,
      existing.filter((m) => m !== found)
    )
    return found
  }
}
