import { describe, expect, it } from 'vitest'
import { workbookToXlsx, xlsxToWorkbook } from '../../src/renderer/formats/xlsx-format'
import type { SerializedWorkbook } from '../../src/shared/model'

describe('xlsx-format', () => {
  it('round-trips values, formulas, styles and merges through a real .xlsx buffer', async () => {
    const doc: SerializedWorkbook = {
      formatVersion: 1,
      activeSheetIndex: 0,
      sheets: [
        {
          name: 'Dados',
          cells: [
            { row: 0, col: 0, content: 10 },
            { row: 0, col: 1, content: '=SUM(A1,A1)' },
            { row: 1, col: 0, content: 'olá' },
            { row: 1, col: 1, content: true }
          ],
          styles: [
            {
              row: 0,
              col: 0,
              style: {
                bold: true,
                italic: true,
                textColor: '#ff0000',
                backgroundColor: '#00ff00',
                hAlign: 'center',
                vAlign: 'middle',
                borders: { top: { color: '#000000' }, left: { color: '#0000ff' } }
              }
            }
          ],
          merges: [{ minRow: 3, minCol: 0, maxRow: 4, maxCol: 1 }]
        }
      ]
    }

    const bytes = await workbookToXlsx(doc)
    expect(bytes[0]).toBe(0x50) // real zip container ('PK' signature), same as .xlsx files always are
    expect(bytes[1]).toBe(0x4b)

    const restored = await xlsxToWorkbook(bytes)
    expect(restored.sheets).toHaveLength(1)
    const sheet = restored.sheets[0]
    expect(sheet.name).toBe('Dados')

    expect(sheet.cells).toEqual(
      expect.arrayContaining([
        { row: 0, col: 0, content: 10 },
        { row: 0, col: 1, content: '=SUM(A1,A1)' },
        { row: 1, col: 0, content: 'olá' },
        { row: 1, col: 1, content: true }
      ])
    )

    expect(sheet.styles).toEqual([
      {
        row: 0,
        col: 0,
        style: {
          bold: true,
          italic: true,
          textColor: '#ff0000',
          backgroundColor: '#00ff00',
          hAlign: 'center',
          vAlign: 'middle',
          borders: { top: { color: '#000000' }, left: { color: '#0000ff' } }
        }
      }
    ])

    expect(sheet.merges).toEqual([{ minRow: 3, minCol: 0, maxRow: 4, maxCol: 1 }])
  })

  it('round-trips multiple sheets, preserving each name', async () => {
    const doc: SerializedWorkbook = {
      formatVersion: 1,
      activeSheetIndex: 0,
      sheets: [
        { name: 'Base', cells: [{ row: 0, col: 0, content: 1 }] },
        { name: 'Relatório', cells: [{ row: 0, col: 0, content: 2 }] }
      ]
    }
    const bytes = await workbookToXlsx(doc)
    const restored = await xlsxToWorkbook(bytes)
    expect(restored.sheets.map((s) => s.name)).toEqual(['Base', 'Relatório'])
  })

  it('omits styles/merges keys for a plain, unstyled sheet', async () => {
    const doc: SerializedWorkbook = {
      formatVersion: 1,
      activeSheetIndex: 0,
      sheets: [{ name: 'Sheet1', cells: [{ row: 0, col: 0, content: 'x' }] }]
    }
    const bytes = await workbookToXlsx(doc)
    const restored = await xlsxToWorkbook(bytes)
    expect(restored.sheets[0].styles).toBeUndefined()
    expect(restored.sheets[0].merges).toBeUndefined()
  })
})
