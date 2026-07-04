import { describe, expect, it } from 'vitest'
import { Selection } from '../../src/renderer/grid/selection'

const MAX_ROW = 99
const MAX_COL = 9

describe('Selection', () => {
  it('starts as a single cell at (0,0)', () => {
    const selection = new Selection(MAX_ROW, MAX_COL)
    expect(selection.activeCell).toEqual({ row: 0, col: 0 })
    expect(selection.normalized).toEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 })
  })

  it('moveTo collapses to a single cell and becomes the new anchor', () => {
    const selection = new Selection(MAX_ROW, MAX_COL)
    selection.extendTo(5, 5)
    selection.moveTo(3, 4)
    expect(selection.current).toEqual({ anchor: { row: 3, col: 4 }, focus: { row: 3, col: 4 } })
  })

  it('moveBy moves relative to the anchor and clamps to bounds', () => {
    const selection = new Selection(MAX_ROW, MAX_COL)
    selection.moveTo(0, 0)
    selection.moveBy(-5, -5)
    expect(selection.activeCell).toEqual({ row: 0, col: 0 })

    selection.moveTo(MAX_ROW, MAX_COL)
    selection.moveBy(10, 10)
    expect(selection.activeCell).toEqual({ row: MAX_ROW, col: MAX_COL })
  })

  it('extendTo keeps the anchor fixed and moves the focus, normalizing regardless of drag direction', () => {
    const selection = new Selection(MAX_ROW, MAX_COL)
    selection.moveTo(5, 5)
    selection.extendTo(2, 8)
    expect(selection.current.anchor).toEqual({ row: 5, col: 5 })
    expect(selection.current.focus).toEqual({ row: 2, col: 8 })
    expect(selection.normalized).toEqual({ minRow: 2, maxRow: 5, minCol: 5, maxCol: 8 })
  })

  it('extendBy extends from the current focus, not the anchor', () => {
    const selection = new Selection(MAX_ROW, MAX_COL)
    selection.moveTo(5, 5)
    selection.extendBy(2, 0)
    selection.extendBy(2, 0)
    expect(selection.current.focus).toEqual({ row: 9, col: 5 })
  })

  it('selectRow spans the full column range with the row header as anchor', () => {
    const selection = new Selection(MAX_ROW, MAX_COL)
    selection.selectRow(4)
    expect(selection.normalized).toEqual({ minRow: 4, maxRow: 4, minCol: 0, maxCol: MAX_COL })
  })

  it('selectColumn spans the full row range', () => {
    const selection = new Selection(MAX_ROW, MAX_COL)
    selection.selectColumn(3)
    expect(selection.normalized).toEqual({ minRow: 0, maxRow: MAX_ROW, minCol: 3, maxCol: 3 })
  })

  it('selectAll spans the entire grid', () => {
    const selection = new Selection(MAX_ROW, MAX_COL)
    selection.selectAll()
    expect(selection.normalized).toEqual({ minRow: 0, maxRow: MAX_ROW, minCol: 0, maxCol: MAX_COL })
  })

  it('selectRange clamps out-of-bounds corners', () => {
    const selection = new Selection(MAX_ROW, MAX_COL)
    selection.selectRange(-5, -5, MAX_ROW + 50, MAX_COL + 50)
    expect(selection.normalized).toEqual({ minRow: 0, maxRow: MAX_ROW, minCol: 0, maxCol: MAX_COL })
  })

  describe('selectAllProgressive', () => {
    it('expands to the whole sheet only on a second *consecutive* call', () => {
      const selection = new Selection(MAX_ROW, MAX_COL)
      const region = { minRow: 2, maxRow: 4, minCol: 1, maxCol: 3 }

      selection.selectAllProgressive(region)
      expect(selection.normalized).toEqual(region)

      selection.selectAllProgressive(region)
      expect(selection.normalized).toEqual({ minRow: 0, maxRow: MAX_ROW, minCol: 0, maxCol: MAX_COL })
    })

    it('does not skip straight to select-all when the region is a single cell matching the current selection', () => {
      // Regression: clicking an isolated empty cell selects just that cell,
      // then the computed "used region" for an empty cell is also just that
      // cell -- these must not be conflated into "already at stage 1".
      const selection = new Selection(MAX_ROW, MAX_COL)
      selection.moveTo(50, 5)
      const isolatedCellRegion = { minRow: 50, maxRow: 50, minCol: 5, maxCol: 5 }

      selection.selectAllProgressive(isolatedCellRegion)
      expect(selection.normalized).toEqual(isolatedCellRegion)

      selection.selectAllProgressive(isolatedCellRegion)
      expect(selection.normalized).toEqual({ minRow: 0, maxRow: MAX_ROW, minCol: 0, maxCol: MAX_COL })
    })

    it('resets the progressive stage when any other selection change happens in between', () => {
      const selection = new Selection(MAX_ROW, MAX_COL)
      const region = { minRow: 2, maxRow: 4, minCol: 1, maxCol: 3 }

      selection.selectAllProgressive(region)
      selection.moveTo(0, 0) // any other interaction in between
      selection.selectAllProgressive(region)

      // Back to "first press" behavior, not select-all.
      expect(selection.normalized).toEqual(region)
    })
  })
})
