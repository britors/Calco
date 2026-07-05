import { describe, expect, it } from 'vitest'
import { StyleStore } from '../../src/renderer/engine/style-store'

describe('StyleStore', () => {
  it('returns an empty style for an untouched cell', () => {
    const store = new StyleStore()
    expect(store.getStyle(1, 0, 0)).toEqual({})
  })

  it('applies a patch to a range of cells and reads it back per cell', () => {
    const store = new StyleStore()
    store.applyPatch(
      1,
      [
        { row: 0, col: 0 },
        { row: 0, col: 1 }
      ],
      { bold: true }
    )
    expect(store.getStyle(1, 0, 0)).toEqual({ bold: true })
    expect(store.getStyle(1, 0, 1)).toEqual({ bold: true })
    expect(store.getStyle(1, 1, 0)).toEqual({})
  })

  it('merges a second patch onto an existing style instead of replacing it', () => {
    const store = new StyleStore()
    store.applyPatch(1, [{ row: 0, col: 0 }], { bold: true })
    store.applyPatch(1, [{ row: 0, col: 0 }], { italic: true })
    expect(store.getStyle(1, 0, 0)).toEqual({ bold: true, italic: true })
  })

  it('clears a key when the patch explicitly sets it to undefined', () => {
    const store = new StyleStore()
    store.applyPatch(1, [{ row: 0, col: 0 }], { bold: true, textColor: '#ff0000' })
    store.applyPatch(1, [{ row: 0, col: 0 }], { bold: undefined })
    expect(store.getStyle(1, 0, 0)).toEqual({ textColor: '#ff0000' })
  })

  it('drops a cell from the sparse map once its style becomes empty', () => {
    const store = new StyleStore()
    store.applyPatch(1, [{ row: 2, col: 2 }], { bold: true })
    store.applyPatch(1, [{ row: 2, col: 2 }], { bold: undefined })
    expect(store.serializeSheet(1)).toEqual([])
  })

  it('merges border sides independently, clearing only the specified side', () => {
    const store = new StyleStore()
    store.applyPatch(1, [{ row: 0, col: 0 }], { borders: { top: { color: '#000' }, left: { color: '#111' } } })
    store.applyPatch(1, [{ row: 0, col: 0 }], { borders: { top: undefined } })
    expect(store.getStyle(1, 0, 0)).toEqual({ borders: { left: { color: '#111' } } })
  })

  describe('undo support (applyPatch/restore)', () => {
    it('applyPatch returns the prior style per cell, and restore reverts to it', () => {
      const store = new StyleStore()
      store.applyPatch(1, [{ row: 0, col: 0 }], { bold: true })
      const before = store.applyPatch(1, [{ row: 0, col: 0 }], { italic: true })
      expect(before).toEqual([{ row: 0, col: 0, style: { bold: true } }])
      expect(store.getStyle(1, 0, 0)).toEqual({ bold: true, italic: true })

      store.restore(1, before)
      expect(store.getStyle(1, 0, 0)).toEqual({ bold: true })
    })

    it('restore can bring back an empty (never-styled) prior state', () => {
      const store = new StyleStore()
      const before = store.applyPatch(1, [{ row: 0, col: 0 }], { bold: true })
      expect(before).toEqual([{ row: 0, col: 0, style: {} }])
      store.restore(1, before)
      expect(store.getStyle(1, 0, 0)).toEqual({})
    })
  })

  describe('serialize / load', () => {
    it('round-trips styled cells through serializeSheet -> loadSheetStyles', () => {
      const store = new StyleStore()
      store.applyPatch(1, [{ row: 3, col: 4 }], { bold: true, backgroundColor: '#00ff00' })
      const serialized = store.serializeSheet(1)

      const reloaded = new StyleStore()
      reloaded.loadSheetStyles(2, serialized)
      expect(reloaded.getStyle(2, 3, 4)).toEqual({ bold: true, backgroundColor: '#00ff00' })
    })
  })

  describe('sheet removal', () => {
    it('removeSheet drops both styles and merges for that sheet id', () => {
      const store = new StyleStore()
      store.applyPatch(1, [{ row: 0, col: 0 }], { bold: true })
      store.addMerge(1, { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 })
      store.removeSheet(1)
      expect(store.getStyle(1, 0, 0)).toEqual({})
      expect(store.mergesFor(1)).toEqual([])
    })
  })

  describe('merges', () => {
    it('adds a merge and finds it by any contained cell', () => {
      const store = new StyleStore()
      const result = store.addMerge(1, { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 })
      expect(result).toEqual([{ minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 }])
      expect(store.findMergeContaining(1, 1, 1)).toEqual({ minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 })
      expect(store.findMergeContaining(1, 2, 2)).toBeUndefined()
    })

    it('rejects (returns null) a merge that overlaps an existing one', () => {
      const store = new StyleStore()
      store.addMerge(1, { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 })
      const rejected = store.addMerge(1, { minRow: 1, minCol: 1, maxRow: 2, maxCol: 2 })
      expect(rejected).toBeNull()
      expect(store.mergesFor(1)).toHaveLength(1)
    })

    it('removeMergeAt removes only the merge containing that cell', () => {
      const store = new StyleStore()
      store.addMerge(1, { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 })
      store.addMerge(1, { minRow: 5, minCol: 5, maxRow: 6, maxCol: 6 })
      const removed = store.removeMergeAt(1, 0, 1)
      expect(removed).toEqual({ minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 })
      expect(store.mergesFor(1)).toEqual([{ minRow: 5, minCol: 5, maxRow: 6, maxCol: 6 }])
    })

    it('removeMergeAt no-ops (returns undefined) when the cell is in no merge', () => {
      const store = new StyleStore()
      expect(store.removeMergeAt(1, 0, 0)).toBeUndefined()
    })

    it('keeps merges independent per sheet id', () => {
      const store = new StyleStore()
      store.addMerge(1, { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 })
      expect(store.mergesFor(2)).toEqual([])
    })
  })

  describe('insert/delete rows and columns', () => {
    it('insertRows shifts style entries at/after the insertion point down, leaving earlier rows alone', () => {
      const store = new StyleStore()
      store.applyPatch(1, [{ row: 0, col: 0 }], { bold: true }) // before the insertion point
      store.applyPatch(1, [{ row: 2, col: 0 }], { italic: true }) // at/after
      store.insertRows(1, 1, 2) // insert 2 rows above row 1

      expect(store.getStyle(1, 0, 0)).toEqual({ bold: true })
      expect(store.getStyle(1, 2, 0)).toEqual({}) // old row 2 vacated
      expect(store.getStyle(1, 4, 0)).toEqual({ italic: true }) // shifted from row 2 to row 4
    })

    it('insertCols is the column-axis mirror of insertRows', () => {
      const store = new StyleStore()
      store.applyPatch(1, [{ row: 0, col: 3 }], { bold: true })
      store.insertCols(1, 1, 1)
      expect(store.getStyle(1, 0, 3)).toEqual({})
      expect(store.getStyle(1, 0, 4)).toEqual({ bold: true })
    })

    it('deleteRows drops style entries within the deleted range and shifts the rest up', () => {
      const store = new StyleStore()
      store.applyPatch(1, [{ row: 0, col: 0 }], { bold: true }) // before the deleted range, untouched
      store.applyPatch(1, [{ row: 2, col: 0 }], { italic: true }) // inside rows 1-3, deleted
      store.applyPatch(1, [{ row: 5, col: 0 }], { textColor: '#ff0000' }) // after, shifts up to row 2
      store.deleteRows(1, 1, 3) // delete rows 1,2,3

      expect(store.getStyle(1, 0, 0)).toEqual({ bold: true })
      expect(store.getStyle(1, 2, 0)).toEqual({ textColor: '#ff0000' })
      expect(store.serializeSheet(1)).toEqual(
        expect.arrayContaining([{ row: 0, col: 0, style: { bold: true } }])
      )
      expect(store.serializeSheet(1)).toHaveLength(2)
    })

    it('deleteCols is the column-axis mirror of deleteRows', () => {
      const store = new StyleStore()
      store.applyPatch(1, [{ row: 0, col: 5 }], { bold: true })
      store.deleteCols(1, 1, 3) // delete cols 1,2,3
      expect(store.getStyle(1, 0, 2)).toEqual({ bold: true }) // old col 5 -> col 2
    })

    it('insertRows grows a merge that spans the insertion point', () => {
      const store = new StyleStore()
      store.addMerge(1, { minRow: 0, minCol: 0, maxRow: 3, maxCol: 1 })
      store.insertRows(1, 2, 1) // insert 1 row inside the merge's span
      expect(store.mergesFor(1)).toEqual([{ minRow: 0, minCol: 0, maxRow: 4, maxCol: 1 }])
    })

    it('insertRows shifts a merge entirely below the insertion point without resizing it', () => {
      const store = new StyleStore()
      store.addMerge(1, { minRow: 5, minCol: 0, maxRow: 6, maxCol: 1 })
      store.insertRows(1, 0, 2)
      expect(store.mergesFor(1)).toEqual([{ minRow: 7, minCol: 0, maxRow: 8, maxCol: 1 }])
    })

    it('deleteRows shrinks a merge whose span partially overlaps the deleted rows', () => {
      const store = new StyleStore()
      store.addMerge(1, { minRow: 1, minCol: 0, maxRow: 5, maxCol: 1 })
      store.deleteRows(1, 2, 3) // delete rows 2,3,4 -- inside the merge
      expect(store.mergesFor(1)).toEqual([{ minRow: 1, minCol: 0, maxRow: 2, maxCol: 1 }])
    })

    it('deleteRows drops a merge entirely contained in the deleted range', () => {
      const store = new StyleStore()
      store.addMerge(1, { minRow: 2, minCol: 0, maxRow: 3, maxCol: 1 })
      store.deleteRows(1, 1, 5) // deletes rows 1..5, fully swallowing the merge
      expect(store.mergesFor(1)).toEqual([])
    })

    it('is a no-op when nothing was styled/merged on the sheet', () => {
      const store = new StyleStore()
      expect(() => store.insertRows(1, 0, 5)).not.toThrow()
      expect(() => store.deleteCols(1, 0, 5)).not.toThrow()
    })
  })
})
