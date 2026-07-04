// The .calco document model (spec section 5). Cells are a sparse list, not a
// dense 2D array -- a dense array over a 100,000-row capacity would be a
// pathological file size for mostly-empty sheets.

export interface SerializedCell {
  row: number
  col: number
  content: string | number | boolean
}

export interface SerializedSheet {
  name: string
  cells: SerializedCell[]
}

export interface SerializedWorkbook {
  formatVersion: 1
  sheets: SerializedSheet[]
  activeSheetIndex: number
}
