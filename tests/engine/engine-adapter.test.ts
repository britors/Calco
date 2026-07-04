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
})
