import { describe, expect, it } from 'vitest'
import { EngineAdapter } from '../../src/renderer/engine/engine-adapter'
import { findMatches, replaceAll, replaceInCell } from '../../src/renderer/grid/find-replace'

describe('findMatches', () => {
  it('returns an empty list for an empty query', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 'hello')
    expect(findMatches(engine, '')).toEqual([])
  })

  it('finds case-insensitive substring matches across the sheet', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 'Hello World')
    engine.setCellContent(1, 2, 'hello there')
    engine.setCellContent(2, 0, 'nothing here')

    expect(findMatches(engine, 'HELLO')).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 2 }
    ])
  })

  it('matches within formula text, not just literal values', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 10)
    engine.setCellContent(0, 1, '=SUM(A1,10)')

    expect(findMatches(engine, 'SUM')).toEqual([{ row: 0, col: 1 }])
  })

  it('returns no matches when nothing matches', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 'abc')
    expect(findMatches(engine, 'xyz')).toEqual([])
  })
})

describe('replaceInCell', () => {
  it('replaces all occurrences within one cell, case-insensitively', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 'Cat and cat and CAT')
    replaceInCell(engine, 0, 0, 'cat', 'dog')
    expect(engine.getCellSnapshot(0, 0).value).toBe('dog and dog and dog')
  })

  it('treats the query as a literal string, not a regex pattern', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 'a.b.c')
    replaceInCell(engine, 0, 0, '.', '-')
    expect(engine.getCellSnapshot(0, 0).value).toBe('a-b-c')
  })
})

describe('replaceAll', () => {
  it('replaces every match in the sheet and returns the count', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 'foo')
    engine.setCellContent(0, 1, 'foobar')
    engine.setCellContent(1, 0, 'nothing')

    const count = replaceAll(engine, 'foo', 'baz')

    expect(count).toBe(2)
    expect(engine.getCellSnapshot(0, 0).value).toBe('baz')
    expect(engine.getCellSnapshot(0, 1).value).toBe('bazbar')
    expect(engine.getCellSnapshot(1, 0).value).toBe('nothing')
  })

  it('replaces a literal inside a formula without breaking evaluation', () => {
    const engine = new EngineAdapter()
    engine.setCellContent(0, 0, 5)
    engine.setCellContent(0, 1, '=A1+10')

    replaceAll(engine, '10', '20')

    expect(engine.getCellSnapshot(0, 1).raw).toBe('=A1+20')
    expect(engine.getCellSnapshot(0, 1).value).toBe(25)
  })
})
