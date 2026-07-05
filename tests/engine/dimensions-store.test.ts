import { describe, expect, it } from 'vitest'
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, DimensionsStore } from '../../src/renderer/engine/dimensions-store'

describe('DimensionsStore', () => {
  it('defaults to the standard row height / column width for untouched cells', () => {
    const store = new DimensionsStore()
    expect(store.getRowHeight(1, 0)).toBe(DEFAULT_ROW_HEIGHT)
    expect(store.getColWidth(1, 0)).toBe(DEFAULT_COL_WIDTH)
  })

  it('stores and reads back an explicit override', () => {
    const store = new DimensionsStore()
    store.setRowHeight(1, 3, 40)
    store.setColWidth(1, 2, 120)
    expect(store.getRowHeight(1, 3)).toBe(40)
    expect(store.getColWidth(1, 2)).toBe(120)
    expect(store.getRowHeight(1, 4)).toBe(DEFAULT_ROW_HEIGHT)
  })

  it('setRowHeight/setColWidth return the prior value, for undo', () => {
    const store = new DimensionsStore()
    expect(store.setRowHeight(1, 0, 40)).toBeUndefined()
    expect(store.setRowHeight(1, 0, 60)).toBe(40)
    expect(store.setColWidth(1, 0, 120)).toBeUndefined()
    expect(store.setColWidth(1, 0, 150)).toBe(120)
  })

  it('setting back to the default drops the override entirely', () => {
    const store = new DimensionsStore()
    store.setRowHeight(1, 0, 40)
    store.setRowHeight(1, 0, DEFAULT_ROW_HEIGHT)
    expect(store.maxOverriddenRow(1)).toBe(-1)
  })

  it('clamps below a sane minimum instead of collapsing to zero/negative', () => {
    const store = new DimensionsStore()
    store.setRowHeight(1, 0, -5)
    store.setColWidth(1, 0, 0)
    expect(store.getRowHeight(1, 0)).toBeGreaterThan(0)
    expect(store.getColWidth(1, 0)).toBeGreaterThan(0)
  })

  it('restoreRowHeight/restoreColWidth revert to an exact prior value, including back to default', () => {
    const store = new DimensionsStore()
    store.setRowHeight(1, 0, 40)
    store.restoreRowHeight(1, 0, undefined)
    expect(store.getRowHeight(1, 0)).toBe(DEFAULT_ROW_HEIGHT)

    store.restoreRowHeight(1, 0, 55)
    expect(store.getRowHeight(1, 0)).toBe(55)
  })

  it('keeps overrides independent per sheet id', () => {
    const store = new DimensionsStore()
    store.setRowHeight(1, 0, 40)
    expect(store.getRowHeight(2, 0)).toBe(DEFAULT_ROW_HEIGHT)
  })

  it('removeSheet drops all row/col overrides for that sheet', () => {
    const store = new DimensionsStore()
    store.setRowHeight(1, 0, 40)
    store.setColWidth(1, 0, 120)
    store.removeSheet(1)
    expect(store.getRowHeight(1, 0)).toBe(DEFAULT_ROW_HEIGHT)
    expect(store.getColWidth(1, 0)).toBe(DEFAULT_COL_WIDTH)
  })

  it('maxOverriddenRow/Col report the highest explicitly-sized index', () => {
    const store = new DimensionsStore()
    expect(store.maxOverriddenRow(1)).toBe(-1)
    store.setRowHeight(1, 5, 40)
    store.setRowHeight(1, 2, 30)
    expect(store.maxOverriddenRow(1)).toBe(5)
  })

  describe('serialize / load', () => {
    it('round-trips overrides through serialize -> load', () => {
      const store = new DimensionsStore()
      store.setRowHeight(1, 3, 40)
      store.setColWidth(1, 7, 150)

      const rowHeights = store.serializeRowHeights(1)
      const colWidths = store.serializeColWidths(1)
      expect(rowHeights).toEqual([{ row: 3, height: 40 }])
      expect(colWidths).toEqual([{ col: 7, width: 150 }])

      const reloaded = new DimensionsStore()
      reloaded.loadSheet(2, rowHeights, colWidths)
      expect(reloaded.getRowHeight(2, 3)).toBe(40)
      expect(reloaded.getColWidth(2, 7)).toBe(150)
    })

    it('serializes an empty array for a sheet with no overrides', () => {
      const store = new DimensionsStore()
      expect(store.serializeRowHeights(1)).toEqual([])
      expect(store.serializeColWidths(1)).toEqual([])
    })
  })
})
