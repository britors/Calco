import { describe, expect, it } from 'vitest'
import { EngineAdapter } from '../../src/renderer/engine/engine-adapter'

describe('EngineAdapter', () => {
  it('constructs without throwing', () => {
    expect(() => new EngineAdapter()).not.toThrow()
  })

  it('reads back a plain numeric literal', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, '42')
    const snapshot = engine.getCellSnapshot(0, 0)
    expect(snapshot.value).toBe(42)
    expect(snapshot.error).toBeUndefined()
  })

  it('evaluates a simple formula', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, '=1+1')
    expect(engine.getCellSnapshot(0, 0).value).toBe(2)
  })

  it('propagates dependency changes through the graph', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, '10')
    engine.setCellContent(0, 1, '=A1*2')
    expect(engine.getCellSnapshot(0, 1).value).toBe(20)

    engine.setCellContent(0, 0, '5')
    expect(engine.getCellSnapshot(0, 1).value).toBe(10)
  })

  it('surfaces errors like #DIV/0!', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, '=1/0')
    const snapshot = engine.getCellSnapshot(0, 0)
    expect(snapshot.value).toBeNull()
    expect(snapshot.error).toBe('#DIV/0!')
  })

  it('grows sheet dimensions past the default 40,000-row limit', () => {
    const engine = new EngineAdapter()
    expect(() => engine.setCellContent(50_000, 0, 'x')).not.toThrow()
    expect(engine.getSheetDimensions().rows).toBeGreaterThan(50_000)
  })

  it('clears a cell back to empty', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, '=1+1')
    engine.setCellContent(0, 0, '')
    const snapshot = engine.getCellSnapshot(0, 0)
    expect(snapshot.value).toBeNull()
    expect(snapshot.raw).toBe('')
  })

  describe('pt-BR locale (spec section 3)', () => {
    it('accepts pt-BR function names, the `;` separator and `,` decimals', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 2)
      engine.setCellContent(0, 1, 3)
      engine.setCellContent(0, 2, '=SOMA(A1;B1)*1,5')
      expect(engine.getCellSnapshot(0, 2).value).toBe(7.5)
      expect(engine.getCellSnapshot(0, 2).raw).toBe('=SOMA(A1;B1)*1,5')
    })

    it('still accepts English function names as input, displayed back in pt-BR', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 2)
      engine.setCellContent(0, 1, 3)
      engine.setCellContent(0, 2, '=SUM(A1;B1)')
      expect(engine.getCellSnapshot(0, 2).value).toBe(5)
      expect(engine.getCellSnapshot(0, 2).raw).toBe('=SOMA(A1;B1)')
    })

    it('persists formulas as canonical English with a comma separator', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, '=SE(1>0;1;0)')
      const doc = engine.serializeWorkbook()
      expect(doc.sheets[0].cells).toEqual([{ row: 0, col: 0, content: '=IF(1>0,1,0)' }])
    })

    it('round-trips a pt-BR formula through save and reload', () => {
      const original = new EngineAdapter()
      original.setCellContent(0, 0, 4)
      original.setCellContent(0, 1, '=SOMA(A1;10)*1,5')
      const doc = original.serializeWorkbook()

      const reloaded = new EngineAdapter()
      reloaded.loadWorkbook(doc)
      expect(reloaded.getCellSnapshot(0, 1).value).toBe(21)
      expect(reloaded.getCellSnapshot(0, 1).raw).toBe('=SOMA(A1;10)*1,5')
      expect(reloaded.serializeWorkbook()).toEqual(doc)
    })
  })

  describe('serializeWorkbook / loadWorkbook', () => {
    it('serializes a sparse cell list, retaining falsy-but-present values', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 0)
      engine.setCellContent(0, 1, false)
      engine.setCellContent(0, 2, '=1+1')

      const doc = engine.serializeWorkbook()
      expect(doc.formatVersion).toBe(1)
      expect(doc.sheets).toHaveLength(1)
      expect(doc.sheets[0].name).toBe('Sheet1')
      expect(doc.sheets[0].cells).toEqual(
        expect.arrayContaining([
          { row: 0, col: 0, content: 0 },
          { row: 0, col: 1, content: false },
          { row: 0, col: 2, content: '=1+1' }
        ])
      )
      // Untouched cells never appear in the sparse list.
      expect(doc.sheets[0].cells).toHaveLength(3)
    })

    it('reconstructs multi-sheet workbooks and recalculates cross-sheet formulas', () => {
      const engine = new EngineAdapter()
      engine.loadWorkbook({
        formatVersion: 1,
        activeSheetIndex: 1,
        sheets: [
          { name: 'Base', cells: [{ row: 0, col: 0, content: 7 }] },
          { name: 'Report', cells: [{ row: 0, col: 0, content: '=Base!A1*10' }] }
        ]
      })

      expect(engine.getCellSnapshot(0, 0).value).toBe(70)
    })

    it('defaults to a single empty sheet when loading an empty sheets array', () => {
      const engine = new EngineAdapter()
      engine.loadWorkbook({ formatVersion: 1, activeSheetIndex: 0, sheets: [] })
      expect(() => engine.getSheetDimensions()).not.toThrow()
    })

    it('round-trips serializeWorkbook -> loadWorkbook (fresh adapter) -> serializeWorkbook', () => {
      const original = new EngineAdapter()
      original.setCellContent(0, 0, 10)
      original.setCellContent(0, 1, '=A1*2')
      original.addSheet('Notes')

      const doc = original.serializeWorkbook()

      const reloaded = new EngineAdapter()
      reloaded.loadWorkbook(doc)
      const roundTripped = reloaded.serializeWorkbook()

      expect(roundTripped).toEqual(doc)
    })
  })

  describe('undo / redo', () => {
    it('undoes and redoes a single edit', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 10)
      engine.setCellContent(0, 0, 20)
      expect(engine.getCellSnapshot(0, 0).value).toBe(20)

      engine.undo()
      expect(engine.getCellSnapshot(0, 0).value).toBe(10)

      engine.redo()
      expect(engine.getCellSnapshot(0, 0).value).toBe(20)
    })

    it('reports canUndo/canRedo correctly and no-ops past the ends of history', () => {
      const engine = new EngineAdapter()
      expect(engine.canUndo()).toBe(false)
      expect(engine.canRedo()).toBe(false)

      expect(() => engine.undo()).not.toThrow()
      expect(engine.undo()).toEqual([])

      engine.setCellContent(0, 0, 1)
      expect(engine.canUndo()).toBe(true)
      engine.undo()
      expect(engine.canUndo()).toBe(false)
      expect(engine.canRedo()).toBe(true)
    })

    it('does not let undo reach past a freshly constructed or loaded document', () => {
      const engine = new EngineAdapter()
      expect(engine.canUndo()).toBe(false)

      engine.loadWorkbook({
        formatVersion: 1,
        activeSheetIndex: 0,
        sheets: [{ name: 'Sheet1', cells: [{ row: 0, col: 0, content: 5 }] }]
      })
      expect(engine.canUndo()).toBe(false)
      expect(engine.getCellSnapshot(0, 0).value).toBe(5)
    })
  })

  describe('clipboard', () => {
    it('copies and pastes a range of literal values', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 1)
      engine.setCellContent(0, 1, 2)

      engine.copyRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 })
      engine.pasteAt(5, 5)

      expect(engine.getCellSnapshot(5, 5).value).toBe(1)
      expect(engine.getCellSnapshot(5, 6).value).toBe(2)
      // Source is untouched by a copy (unlike a cut).
      expect(engine.getCellSnapshot(0, 0).value).toBe(1)
    })

    it('adjusts relative references when pasting a copied formula', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 10)
      engine.setCellContent(1, 0, 20)
      engine.setCellContent(0, 1, '=A1*2') // references the cell directly to its left

      engine.copyRange({ minRow: 0, maxRow: 0, minCol: 1, maxCol: 1 })
      engine.pasteAt(1, 1) // one row down -- relative ref should now point at A2 (20)

      expect(engine.getCellSnapshot(1, 1).raw).toBe('=A2*2')
      expect(engine.getCellSnapshot(1, 1).value).toBe(40)
    })

    it('clears the source range after cut + paste', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 'x')

      engine.cutRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 })
      engine.pasteAt(3, 3)

      expect(engine.getCellSnapshot(3, 3).value).toBe('x')
      expect(engine.getCellSnapshot(0, 0).value).toBeNull()
    })

    it('pasteExternalRows writes a block and coerces nothing itself (caller-parsed values)', () => {
      const engine = new EngineAdapter()
      engine.pasteExternalRows(2, 2, [
        [1, 'two'],
        [3, 'four']
      ])
      expect(engine.getCellSnapshot(2, 2).value).toBe(1)
      expect(engine.getCellSnapshot(2, 3).value).toBe('two')
      expect(engine.getCellSnapshot(3, 2).value).toBe(3)
      expect(engine.getCellSnapshot(3, 3).value).toBe('four')
    })

    it('reports isClipboardEmpty/clearClipboard correctly, and pasteAt no-ops when empty', () => {
      const engine = new EngineAdapter()
      expect(engine.isClipboardEmpty()).toBe(true)
      expect(engine.pasteAt(0, 0)).toEqual([])

      engine.setCellContent(0, 0, 1)
      engine.copyRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 })
      expect(engine.isClipboardEmpty()).toBe(false)

      engine.clearClipboard()
      expect(engine.isClipboardEmpty()).toBe(true)
      expect(engine.pasteAt(1, 1)).toEqual([])
    })
  })

  describe('cell styling (spec section 6)', () => {
    it('applies and reads back a style patch, defaulting to {} when unstyled', () => {
      const engine = new EngineAdapter()
      expect(engine.getCellStyle(0, 0)).toEqual({})
      engine.applyStyle({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }, { bold: true })
      expect(engine.getCellStyle(0, 0)).toEqual({ bold: true })
    })

    it('applies a style patch across an entire range', () => {
      const engine = new EngineAdapter()
      engine.applyStyle({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }, { backgroundColor: '#ffff00' })
      expect(engine.getCellStyle(0, 0).backgroundColor).toBe('#ffff00')
      expect(engine.getCellStyle(1, 1).backgroundColor).toBe('#ffff00')
      expect(engine.getCellStyle(2, 2).backgroundColor).toBeUndefined()
    })

    it('keeps styles independent per sheet', () => {
      const engine = new EngineAdapter()
      const secondId = engine.addSheet('Sheet2')
      engine.applyStyle({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }, { bold: true })
      engine.setActiveSheetId(secondId)
      expect(engine.getCellStyle(0, 0)).toEqual({})
    })

    it('persists styles through serializeWorkbook / loadWorkbook', () => {
      const engine = new EngineAdapter()
      engine.applyStyle({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }, { bold: true, textColor: '#ff0000' })
      const doc = engine.serializeWorkbook()
      expect(doc.sheets[0].styles).toEqual([{ row: 0, col: 0, style: { bold: true, textColor: '#ff0000' } }])

      const reloaded = new EngineAdapter()
      reloaded.loadWorkbook(doc)
      expect(reloaded.getCellStyle(0, 0)).toEqual({ bold: true, textColor: '#ff0000' })
    })

    it('omits the styles key entirely for an unstyled sheet', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 1)
      const doc = engine.serializeWorkbook()
      expect(doc.sheets[0].styles).toBeUndefined()
    })
  })

  describe('merges (spec section 6)', () => {
    it('merges a range and finds it from any contained cell', () => {
      const engine = new EngineAdapter()
      engine.mergeRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 })
      expect(engine.findMergeContaining(1, 1)).toEqual({ minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 })
      expect(engine.getMerges()).toEqual([{ minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 }])
    })

    it('no-ops on a single-cell range', () => {
      const engine = new EngineAdapter()
      engine.mergeRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 })
      expect(engine.getMerges()).toEqual([])
    })

    it('no-ops when the new range overlaps an existing merge', () => {
      const engine = new EngineAdapter()
      engine.mergeRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 })
      engine.mergeRange({ minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 })
      expect(engine.getMerges()).toHaveLength(1)
    })

    it('unmergeAt removes the merge containing that cell', () => {
      const engine = new EngineAdapter()
      engine.mergeRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 })
      engine.unmergeAt(0, 1)
      expect(engine.getMerges()).toEqual([])
    })

    it('persists merges through serializeWorkbook / loadWorkbook', () => {
      const engine = new EngineAdapter()
      engine.mergeRange({ minRow: 2, maxRow: 3, minCol: 2, maxCol: 3 })
      const doc = engine.serializeWorkbook()
      expect(doc.sheets[0].merges).toEqual([{ minRow: 2, minCol: 2, maxRow: 3, maxCol: 3 }])

      const reloaded = new EngineAdapter()
      reloaded.loadWorkbook(doc)
      expect(reloaded.getMerges()).toEqual([{ minRow: 2, minCol: 2, maxRow: 3, maxCol: 3 }])
    })
  })

  describe('unified undo/redo across content + style + merge', () => {
    it('undoes a style change without touching prior cell content', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 42)
      engine.applyStyle({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }, { bold: true })

      engine.undo()
      expect(engine.getCellStyle(0, 0)).toEqual({})
      expect(engine.getCellSnapshot(0, 0).value).toBe(42)
    })

    it('undoes in exact chronological order across mixed content/style/merge actions', () => {
      const engine = new EngineAdapter()
      engine.setCellContent(0, 0, 1) // 1: content
      engine.applyStyle({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }, { bold: true }) // 2: style
      engine.mergeRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }) // 3: merge
      engine.setCellContent(1, 1, 2) // 4: content

      engine.undo() // undoes 4
      expect(engine.getCellSnapshot(1, 1).value).toBeNull()
      expect(engine.getMerges()).toHaveLength(1)

      engine.undo() // undoes 3
      expect(engine.getMerges()).toEqual([])
      expect(engine.getCellStyle(0, 0)).toEqual({ bold: true })

      engine.undo() // undoes 2
      expect(engine.getCellStyle(0, 0)).toEqual({})
      expect(engine.getCellSnapshot(0, 0).value).toBe(1)

      engine.undo() // undoes 1
      expect(engine.getCellSnapshot(0, 0).value).toBeNull()
      expect(engine.canUndo()).toBe(false)
    })

    it('redo replays a style change back on', () => {
      const engine = new EngineAdapter()
      engine.applyStyle({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }, { italic: true })
      engine.undo()
      expect(engine.getCellStyle(0, 0)).toEqual({})

      engine.redo()
      expect(engine.getCellStyle(0, 0)).toEqual({ italic: true })
    })

    it('a new action after an undo clears the redo stack, content and style alike', () => {
      const engine = new EngineAdapter()
      engine.applyStyle({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }, { bold: true })
      engine.undo()
      expect(engine.canRedo()).toBe(true)

      engine.setCellContent(0, 0, 'fresh action')
      expect(engine.canRedo()).toBe(false)
      engine.redo()
      expect(engine.getCellStyle(0, 0)).toEqual({}) // the old style redo never replayed
    })

    it('canUndo/canRedo reflect style and merge actions, not just content', () => {
      const engine = new EngineAdapter()
      expect(engine.canUndo()).toBe(false)
      engine.mergeRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 })
      expect(engine.canUndo()).toBe(true)
      engine.undo()
      expect(engine.canUndo()).toBe(false)
      expect(engine.canRedo()).toBe(true)
    })
  })

  describe('sheet management', () => {
    it('lists sheets and reflects add/rename', () => {
      const engine = new EngineAdapter()
      expect(engine.listSheets().map((s) => s.name)).toEqual(['Sheet1'])

      const secondId = engine.addSheet()
      expect(engine.listSheets().map((s) => s.name)).toEqual(['Sheet1', 'Sheet2'])

      engine.renameSheet(secondId, 'Report')
      expect(engine.listSheets().map((s) => s.name)).toEqual(['Sheet1', 'Report'])
    })

    it('setActiveSheetId changes which sheet setCellContent/getCellSnapshot target', () => {
      const engine = new EngineAdapter()
      const firstId = engine.getActiveSheetId()
      const secondId = engine.addSheet('Sheet2')

      engine.setActiveSheetId(firstId)
      engine.setCellContent(0, 0, 'on sheet 1')

      engine.setActiveSheetId(secondId)
      engine.setCellContent(0, 0, 'on sheet 2')
      expect(engine.getCellSnapshot(0, 0).value).toBe('on sheet 2')

      engine.setActiveSheetId(firstId)
      expect(engine.getCellSnapshot(0, 0).value).toBe('on sheet 1')
    })

    it('removeSheet reassigns activeSheetId when the active sheet is removed', () => {
      const engine = new EngineAdapter()
      const firstId = engine.getActiveSheetId()
      const secondId = engine.addSheet('Sheet2')

      engine.setActiveSheetId(secondId)
      engine.removeSheet(secondId)

      expect(engine.listSheets().map((s) => s.id)).toEqual([firstId])
      expect(engine.getActiveSheetId()).toBe(firstId)
    })

    it('removeSheet no-ops rather than reaching zero sheets', () => {
      const engine = new EngineAdapter()
      const onlyId = engine.getActiveSheetId()

      engine.removeSheet(onlyId)

      expect(engine.listSheets()).toHaveLength(1)
      expect(engine.getActiveSheetId()).toBe(onlyId)
    })
  })
})
