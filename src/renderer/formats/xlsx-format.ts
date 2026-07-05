import * as ExcelJS from 'exceljs'
import type {
  CellBorders,
  CellStyle,
  HorizontalAlign,
  SerializedCell,
  SerializedMerge,
  SerializedSheet,
  SerializedStyledCell,
  SerializedWorkbook,
  VerticalAlign
} from '@shared/model'

const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const
const H_ALIGNS: readonly string[] = ['left', 'center', 'right']
const V_ALIGNS: readonly string[] = ['top', 'middle', 'bottom']

function toArgb(hex: string): string {
  return `FF${hex.replace('#', '').toUpperCase()}`
}

function fromArgb(argb: string | undefined): string | undefined {
  if (!argb || argb.length < 6) return undefined
  return `#${argb.slice(-6).toLowerCase()}`
}

function styleToExcel(style: CellStyle): Partial<ExcelJS.Style> {
  const excel: Partial<ExcelJS.Style> = {}

  if (style.bold || style.italic || style.textColor) {
    excel.font = {
      ...(style.bold !== undefined && { bold: style.bold }),
      ...(style.italic !== undefined && { italic: style.italic }),
      ...(style.textColor && { color: { argb: toArgb(style.textColor) } })
    }
  }
  if (style.backgroundColor) {
    excel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(style.backgroundColor) } }
  }
  if (style.hAlign || style.vAlign) {
    excel.alignment = {
      ...(style.hAlign && { horizontal: style.hAlign }),
      ...(style.vAlign && { vertical: style.vAlign })
    }
  }
  if (style.borders) {
    const border: Partial<ExcelJS.Borders> = {}
    for (const side of BORDER_SIDES) {
      const b = style.borders[side]
      if (b) border[side] = { style: 'thin', color: { argb: toArgb(b.color) } }
    }
    excel.border = border
  }
  return excel
}

function excelToStyle(cell: ExcelJS.Cell): CellStyle {
  const style: CellStyle = {}
  if (cell.font?.bold) style.bold = true
  if (cell.font?.italic) style.italic = true
  const textColor = fromArgb(cell.font?.color?.argb)
  if (textColor) style.textColor = textColor

  const fill = cell.fill
  if (fill && fill.type === 'pattern' && fill.pattern === 'solid') {
    const bg = fromArgb(fill.fgColor?.argb)
    if (bg) style.backgroundColor = bg
  }

  const hAlign = cell.alignment?.horizontal
  if (hAlign && H_ALIGNS.includes(hAlign)) style.hAlign = hAlign as HorizontalAlign
  const vAlign = cell.alignment?.vertical
  if (vAlign && V_ALIGNS.includes(vAlign)) style.vAlign = vAlign as VerticalAlign

  if (cell.border) {
    const borders: CellBorders = {}
    for (const side of BORDER_SIDES) {
      const color = fromArgb(cell.border[side]?.color?.argb)
      if (color) borders[side] = { color }
    }
    if (Object.keys(borders).length > 0) style.borders = borders
  }
  return style
}

function parseA1Cell(ref: string): { row: number; col: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!match) throw new Error(`Referência de célula inválida no .xlsx: ${ref}`)
  const [, letters, digits] = match
  let col = 0
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(digits) - 1, col: col - 1 }
}

function parseA1Range(range: string): SerializedMerge {
  const [start, end] = range.split(':')
  const a = parseA1Cell(start)
  const b = parseA1Cell(end ?? start)
  return {
    minRow: Math.min(a.row, b.row),
    minCol: Math.min(a.col, b.col),
    maxRow: Math.max(a.row, b.row),
    maxCol: Math.max(a.col, b.col)
  }
}

/** Canonical SerializedWorkbook -> .xlsx bytes. Formulas are already stored as
 *  canonical English strings (e.g. "=SUM(A1,B1)"), which is exactly the
 *  syntax exceljs/Excel expect (minus the leading '='), so no translation is
 *  needed here beyond stripping/adding that leading sign. */
export async function workbookToXlsx(doc: SerializedWorkbook): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  for (const sheet of doc.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name)

    for (const cell of sheet.cells) {
      const excelCell = worksheet.getCell(cell.row + 1, cell.col + 1)
      if (typeof cell.content === 'string' && cell.content.startsWith('=')) {
        excelCell.value = { formula: cell.content.slice(1) }
      } else {
        excelCell.value = cell.content
      }
    }

    for (const styled of sheet.styles ?? []) {
      const excelCell = worksheet.getCell(styled.row + 1, styled.col + 1)
      const excelStyle = styleToExcel(styled.style)
      if (excelStyle.font) excelCell.font = excelStyle.font
      if (excelStyle.fill) excelCell.fill = excelStyle.fill
      if (excelStyle.alignment) excelCell.alignment = excelStyle.alignment
      if (excelStyle.border) excelCell.border = excelStyle.border
    }

    for (const merge of sheet.merges ?? []) {
      worksheet.mergeCells(merge.minRow + 1, merge.minCol + 1, merge.maxRow + 1, merge.maxCol + 1)
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

/** .xlsx bytes -> SerializedWorkbook. Formulas come back as canonical English
 *  strings (exceljs/Excel's native syntax) with a leading '=' re-added, ready
 *  to persist or feed straight into EngineAdapter.loadWorkbook. */
export async function xlsxToWorkbook(bytes: Uint8Array): Promise<SerializedWorkbook> {
  const workbook = new ExcelJS.Workbook()
  // exceljs's types demand a Node Buffer, but its browser build happily
  // accepts a plain Uint8Array at runtime (verified) -- casting through
  // `Parameters<...>` avoids pulling in @types/node just for this name.
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])

  const sheets: SerializedSheet[] = []
  workbook.eachSheet((worksheet) => {
    const cells: SerializedCell[] = []
    const styles: SerializedStyledCell[] = []

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const rowIndex = rowNumber - 1
        const colIndex = colNumber - 1

        // A merged cell's non-anchor members mirror the anchor's value in
        // exceljs -- only the anchor (top-left) carries real content here.
        if (cell.isMerged && cell.master.address !== cell.address) return

        let content: string | number | boolean | null = null
        if (cell.type === ExcelJS.ValueType.Formula) {
          content = `=${cell.formula}`
        } else if (
          typeof cell.value === 'number' ||
          typeof cell.value === 'string' ||
          typeof cell.value === 'boolean'
        ) {
          content = cell.value
        } else if (cell.value instanceof Date) {
          content = cell.value.toISOString() // date literals not supported yet (matches calco-format)
        }
        if (content !== null && content !== '') cells.push({ row: rowIndex, col: colIndex, content })

        const style = excelToStyle(cell)
        if (Object.keys(style).length > 0) styles.push({ row: rowIndex, col: colIndex, style })
      })
    })

    const mergeRanges = (worksheet.model as unknown as { merges?: string[] }).merges ?? []
    const merges = mergeRanges.map(parseA1Range)

    sheets.push({
      name: worksheet.name,
      cells,
      ...(styles.length > 0 && { styles }),
      ...(merges.length > 0 && { merges })
    })
  })

  return { formatVersion: 1, sheets, activeSheetIndex: 0 }
}
