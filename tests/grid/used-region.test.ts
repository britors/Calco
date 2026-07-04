import { describe, expect, it } from 'vitest'
import { EngineAdapter } from '../../src/renderer/engine/engine-adapter'
import { computeUsedRegion } from '../../src/renderer/grid/used-region'

describe('computeUsedRegion', () => {
  it('selects just the active cell when it is empty', () => {
    const engine = new EngineAdapter()
    expect(computeUsedRegion(engine, 10, 10)).toEqual({ minRow: 10, maxRow: 10, minCol: 10, maxCol: 10 })
  })

  it('grows to a fully populated rectangular block', () => {
    const engine = new EngineAdapter()
    for (let row = 2; row <= 4; row++) {
      for (let col = 1; col <= 3; col++) {
        engine.setCellContent(row, col, row * 10 + col)
      }
    }
    expect(computeUsedRegion(engine, 3, 2)).toEqual({ minRow: 2, maxRow: 4, minCol: 1, maxCol: 3 })
  })

  it('grows around an irregular (L-shaped) block via bounding-box expansion', () => {
    const engine = new EngineAdapter()
    // An L shape: a horizontal bar plus one extra cell hanging off the end,
    // still within one bounding box once expansion completes.
    engine.setCellContent(0, 0, 1)
    engine.setCellContent(0, 1, 1)
    engine.setCellContent(0, 2, 1)
    engine.setCellContent(1, 2, 1)
    expect(computeUsedRegion(engine, 0, 0)).toEqual({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 })
  })

  it('stops at a surrounding blank border and does not include a disjoint island', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 'a')
    engine.setCellContent(0, 1, 'b')
    // Disjoint island, separated by an empty row/col gap.
    engine.setCellContent(5, 5, 'far away')

    expect(computeUsedRegion(engine, 0, 0)).toEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 })
  })
})
