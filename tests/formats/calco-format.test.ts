import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { packCalcoFile, unpackCalcoFile } from '../../src/renderer/formats/calco-format'
import type { SerializedWorkbook } from '../../src/shared/model'

const sample: SerializedWorkbook = {
  formatVersion: 1,
  activeSheetIndex: 1,
  sheets: [
    {
      name: 'Sheet1',
      cells: [
        { row: 0, col: 0, content: 10 },
        { row: 0, col: 1, content: '=A1*2' }
      ]
    },
    {
      name: 'Sheet2',
      cells: [{ row: 2, col: 3, content: 'hello' }]
    }
  ]
}

describe('calco-format', () => {
  it('round-trips a workbook through pack/unpack', () => {
    const bytes = packCalcoFile(sample, '0.1.0')
    const restored = unpackCalcoFile(bytes)
    expect(restored).toEqual(sample)
  })

  it('produces a real zip with manifest.json and workbook.json entries', () => {
    const bytes = packCalcoFile(sample, '0.1.0')
    // Local file header signature 'PK\x03\x04'
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('rejects a file from an unknown future format version', () => {
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify({ formatVersion: 99, generatedBy: 'Calco 9.9.9' })),
      'workbook.json': strToU8(JSON.stringify(sample))
    })
    expect(() => unpackCalcoFile(bytes)).toThrow(/versão de formato/i)
  })

  it('rejects a zip missing workbook.json', () => {
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify({ formatVersion: 1, generatedBy: 'Calco 0.1.0' }))
    })
    expect(() => unpackCalcoFile(bytes)).toThrow()
  })
})
