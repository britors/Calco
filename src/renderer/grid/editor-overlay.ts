import type { EngineAdapter } from '../engine/engine-adapter'
import { cellRect } from './hit-test'
import type { GridMetrics, ScrollState } from './viewport'

export interface EditorCloseResult {
  committed: boolean
  dRow: number
  dCol: number
}

/**
 * A single reusable <input> overlay positioned over the active cell.
 * Owns its own commit/cancel logic; the grid only needs to react to the
 * result (move selection, re-render, refocus) via the onClose callback.
 */
export class EditorOverlay {
  private readonly input: HTMLInputElement
  private editing: { row: number; col: number } | null = null

  constructor(
    container: HTMLElement,
    private readonly engine: EngineAdapter,
    private readonly metrics: GridMetrics,
    private readonly onClose: (result: EditorCloseResult) => void
  ) {
    const input = document.createElement('input')
    input.type = 'text'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.style.position = 'absolute'
    input.style.display = 'none'
    input.style.boxSizing = 'border-box'
    input.style.font = '13px sans-serif'
    input.style.border = '2px solid #1a73e8'
    input.style.padding = '0 3px'
    input.style.margin = '0'
    input.style.outline = 'none'
    input.style.background = '#ffffff'
    input.style.color = '#1a1a1a'
    container.appendChild(input)
    this.input = input

    this.input.addEventListener('keydown', (e) => this.handleKeydown(e))
    this.input.addEventListener('blur', () => this.commit(0, 0))
  }

  get isEditing(): boolean {
    return this.editing !== null
  }

  open(row: number, col: number, scroll: ScrollState, initialValue: string, selectAll: boolean): void {
    this.editing = { row, col }
    const rect = cellRect(row, col, this.metrics, scroll)
    this.input.style.left = `${rect.x}px`
    this.input.style.top = `${rect.y}px`
    this.input.style.width = `${rect.width}px`
    this.input.style.height = `${rect.height}px`
    this.input.style.display = 'block'
    this.input.value = initialValue
    this.input.focus()
    if (selectAll) {
      this.input.select()
    } else {
      const len = this.input.value.length
      this.input.setSelectionRange(len, len)
    }
  }

  reposition(scroll: ScrollState): void {
    if (!this.editing) return
    const rect = cellRect(this.editing.row, this.editing.col, this.metrics, scroll)
    this.input.style.left = `${rect.x}px`
    this.input.style.top = `${rect.y}px`
  }

  /** Commits without a forced navigation move (e.g. clicking away mid-edit). */
  commitInPlace(): void {
    this.commit(0, 0)
  }

  destroy(): void {
    this.input.remove()
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.commit(1, 0)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      this.commit(0, e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      this.cancel()
    }
    e.stopPropagation()
  }

  private commit(dRow: number, dCol: number): void {
    if (!this.editing) return
    const { row, col } = this.editing
    this.engine.setCellContent(row, col, this.input.value)
    this.editing = null
    this.input.style.display = 'none'
    this.onClose({ committed: true, dRow, dCol })
  }

  private cancel(): void {
    this.editing = null
    this.input.style.display = 'none'
    this.onClose({ committed: false, dRow: 0, dCol: 0 })
  }
}
