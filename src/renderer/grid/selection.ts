export interface CellPos {
  row: number
  col: number
}

export interface SelectionRange {
  anchor: CellPos // active cell -- where editing happens, where header highlighting is anchored
  focus: CellPos // the other drag/extension corner
}

export interface NormalizedRange {
  minRow: number
  maxRow: number
  minCol: number
  maxCol: number
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max))
}

/** Single rectangular range selection (anchor + focus), clamped to [0,maxRow] x [0,maxCol]. */
export class Selection {
  private state: SelectionRange = { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } }
  // Tracks whether the *immediately preceding* mutation was a Ctrl+A
  // "select current region" step, so a second consecutive Ctrl+A expands to
  // the whole sheet -- any other mutation (click, drag, arrow key, ...)
  // resets this, so a same-valued single-cell region from a plain click
  // isn't mistaken for a completed first Ctrl+A press.
  private selectAllStage: 0 | 1 = 0

  constructor(
    private readonly maxRow: number,
    private readonly maxCol: number
  ) {}

  get current(): SelectionRange {
    return this.state
  }

  get activeCell(): CellPos {
    return this.state.anchor
  }

  get normalized(): NormalizedRange {
    const { anchor, focus } = this.state
    return {
      minRow: Math.min(anchor.row, focus.row),
      maxRow: Math.max(anchor.row, focus.row),
      minCol: Math.min(anchor.col, focus.col),
      maxCol: Math.max(anchor.col, focus.col)
    }
  }

  private clampPos(row: number, col: number): CellPos {
    return { row: clamp(row, this.maxRow), col: clamp(col, this.maxCol) }
  }

  /** Collapses to a single cell (plain click, arrow keys without shift). */
  moveTo(row: number, col: number): void {
    this.selectAllStage = 0
    const pos = this.clampPos(row, col)
    this.state = { anchor: pos, focus: pos }
  }

  moveBy(dRow: number, dCol: number): void {
    this.moveTo(this.state.anchor.row + dRow, this.state.anchor.col + dCol)
  }

  /** Keeps the anchor fixed, moves the focus (shift+click, shift+arrow, drag). */
  extendTo(row: number, col: number): void {
    this.selectAllStage = 0
    this.state = { anchor: this.state.anchor, focus: this.clampPos(row, col) }
  }

  extendBy(dRow: number, dCol: number): void {
    this.extendTo(this.state.focus.row + dRow, this.state.focus.col + dCol)
  }

  selectRow(row: number): void {
    this.selectRange(row, 0, row, this.maxCol)
  }

  selectColumn(col: number): void {
    this.selectRange(0, col, this.maxRow, col)
  }

  selectRange(minRow: number, minCol: number, maxRow: number, maxCol: number): void {
    this.selectAllStage = 0
    this.state = {
      anchor: this.clampPos(minRow, minCol),
      focus: this.clampPos(maxRow, maxCol)
    }
  }

  selectAll(): void {
    this.selectRange(0, 0, this.maxRow, this.maxCol)
  }

  /**
   * Excel-style progressive Ctrl+A: first press selects `usedRegion` (the
   * caller-computed current region); a second consecutive press (with no
   * other selection change in between) selects the whole sheet.
   */
  selectAllProgressive(usedRegion: NormalizedRange): void {
    if (this.selectAllStage === 1) {
      this.selectAll()
      return
    }
    this.state = {
      anchor: this.clampPos(usedRegion.minRow, usedRegion.minCol),
      focus: this.clampPos(usedRegion.maxRow, usedRegion.maxCol)
    }
    this.selectAllStage = 1
  }
}
