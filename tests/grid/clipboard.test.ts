import { describe, expect, it } from 'vitest'
import { EngineAdapter } from '../../src/renderer/engine/engine-adapter'
import { buildHtmlTable, buildTsv, buildValuesMatrix, parseTsv } from '../../src/renderer/grid/clipboard'

describe('clipboard text (de)serialization', () => {
  it('buildTsv joins raw cell content with tabs and rows with newlines', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 10)
    engine.setCellContent(0, 1, '=A1*2')
    engine.setCellContent(1, 0, 'hello')
    // (1,1) left empty on purpose.

    const tsv = buildTsv(engine, { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 })
    expect(tsv).toBe('10\t=A1*2\nhello\t')
  })

  it('buildHtmlTable wraps cells in a bare table shell and escapes markup', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, '<b>x</b>')
    const html = buildHtmlTable(engine, { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 })
    expect(html).toBe('<table><tr><td>&lt;b&gt;x&lt;/b&gt;</td></tr></table>')
  })

  it('buildValuesMatrix reads computed values, not formulas', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 10)
    engine.setCellContent(0, 1, '=A1*2')
    const matrix = buildValuesMatrix(engine, { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 })
    expect(matrix).toEqual([[10, 20]])
  })

  it('parseTsv coerces numeric-looking cells to numbers and keeps text as text', () => {
    expect(parseTsv('10\thello\n20\tworld')).toEqual([
      [10, 'hello'],
      [20, 'world']
    ])
  })

  it('parseTsv keeps empty cells as empty strings', () => {
    expect(parseTsv('1\t\n\t2')).toEqual([
      [1, ''],
      ['', 2]
    ])
  })

  it('parseTsv drops a single trailing blank line', () => {
    expect(parseTsv('1\t2\n')).toEqual([[1, 2]])
  })

  it('parseTsv handles a single cell with no tabs or newlines', () => {
    expect(parseTsv('42')).toEqual([[42]])
  })
})
