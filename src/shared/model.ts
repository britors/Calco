// The .calco document model (spec section 5). Cells are a sparse list, not a
// dense 2D array -- a dense array over a 100,000-row capacity would be a
// pathological file size for mostly-empty sheets.

export interface SerializedCell {
  row: number
  col: number
  content: string | number | boolean
}

export type HorizontalAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'middle' | 'bottom'

export interface BorderStyle {
  color: string
}

export interface CellBorders {
  top?: BorderStyle
  right?: BorderStyle
  bottom?: BorderStyle
  left?: BorderStyle
}

// A cell's presentation-only formatting (spec section 6 -- "Formatação
// básica"). Never affects HyperFormula's computed value, only how a cell is
// painted on the canvas grid.
export interface CellStyle {
  bold?: boolean
  italic?: boolean
  textColor?: string
  backgroundColor?: string
  hAlign?: HorizontalAlign
  vAlign?: VerticalAlign
  borders?: CellBorders
}

export interface SerializedStyledCell {
  row: number
  col: number
  style: CellStyle
}

export interface SerializedMerge {
  minRow: number
  minCol: number
  maxRow: number
  maxCol: number
}

export interface SerializedSheet {
  name: string
  cells: SerializedCell[]
  // Optional and omitted when empty -- old .calco files without these keys
  // load fine as unstyled/unmerged sheets (forward-tolerant reading, spec
  // section 5).
  styles?: SerializedStyledCell[]
  merges?: SerializedMerge[]
}

export interface SerializedWorkbook {
  formatVersion: 1
  sheets: SerializedSheet[]
  activeSheetIndex: number
}
