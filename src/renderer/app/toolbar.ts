import type { CellStyle, HorizontalAlign, VerticalAlign } from '@shared/model'

export interface ToolbarHandlers {
  onToggleBold(): void
  onToggleItalic(): void
  onTextColor(color: string): void
  onBackgroundColor(color: string): void
  onToggleBorder(): void
  onAlignH(align: HorizontalAlign): void
  onAlignV(align: VerticalAlign): void
  onToggleMerge(): void
}

export interface Toolbar {
  /** Reflects the active cell's current style in the toggle buttons (pressed/unpressed). */
  setActiveStyle(style: CellStyle, isMerged: boolean): void
}

const ACTIVE_BG = '#dbe7ff'
const IDLE_BG = 'transparent'

function makeButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.title = title
  btn.style.border = '1px solid transparent'
  btn.style.background = IDLE_BG
  btn.style.cursor = 'pointer'
  btn.style.width = '28px'
  btn.style.height = '24px'
  btn.style.borderRadius = '3px'
  btn.style.color = '#333333'
  btn.style.font = '13px sans-serif'
  btn.addEventListener('click', onClick)
  return btn
}

function setPressed(btn: HTMLButtonElement, pressed: boolean): void {
  btn.style.background = pressed ? ACTIVE_BG : IDLE_BG
  btn.style.borderColor = pressed ? '#1a73e8' : 'transparent'
}

function makeSeparator(): HTMLElement {
  const sep = document.createElement('div')
  sep.style.width = '1px'
  sep.style.margin = '4px 4px'
  sep.style.background = '#dcdfe3'
  return sep
}

/** Cell-formatting toolbar -- a dumb UI component, no engine coupling (spec section 6, "Formatação básica"). */
export function mountToolbar(container: HTMLElement, handlers: ToolbarHandlers): Toolbar {
  container.style.display = 'flex'
  container.style.alignItems = 'center'
  container.style.gap = '2px'
  container.style.height = '32px'
  container.style.padding = '0 6px'
  container.style.background = '#f8f9fa'
  container.style.borderBottom = '1px solid #dcdfe3'

  const boldBtn = makeButton('N', 'Negrito', handlers.onToggleBold)
  boldBtn.style.fontWeight = 'bold'
  const italicBtn = makeButton('I', 'Itálico', handlers.onToggleItalic)
  italicBtn.style.fontStyle = 'italic'

  const textColorInput = document.createElement('input')
  textColorInput.type = 'color'
  textColorInput.title = 'Cor da fonte'
  textColorInput.value = '#000000'
  textColorInput.style.width = '24px'
  textColorInput.style.height = '24px'
  textColorInput.style.border = 'none'
  textColorInput.style.background = 'transparent'
  textColorInput.style.cursor = 'pointer'
  textColorInput.addEventListener('input', () => handlers.onTextColor(textColorInput.value))

  const backgroundColorInput = document.createElement('input')
  backgroundColorInput.type = 'color'
  backgroundColorInput.title = 'Cor de fundo'
  backgroundColorInput.value = '#ffff00'
  backgroundColorInput.style.width = '24px'
  backgroundColorInput.style.height = '24px'
  backgroundColorInput.style.border = 'none'
  backgroundColorInput.style.background = 'transparent'
  backgroundColorInput.style.cursor = 'pointer'
  backgroundColorInput.addEventListener('input', () => handlers.onBackgroundColor(backgroundColorInput.value))

  const borderBtn = makeButton('▦', 'Bordas (alternar)', handlers.onToggleBorder)

  const alignLeftBtn = makeButton('◀', 'Alinhar à esquerda', () => handlers.onAlignH('left'))
  const alignCenterBtn = makeButton('▬', 'Centralizar', () => handlers.onAlignH('center'))
  const alignRightBtn = makeButton('▶', 'Alinhar à direita', () => handlers.onAlignH('right'))

  const alignTopBtn = makeButton('▲', 'Alinhar ao topo', () => handlers.onAlignV('top'))
  const alignMiddleBtn = makeButton('■', 'Centralizar verticalmente', () => handlers.onAlignV('middle'))
  const alignBottomBtn = makeButton('▼', 'Alinhar à base', () => handlers.onAlignV('bottom'))

  const mergeBtn = makeButton('⊞', 'Mesclar/desmesclar células', handlers.onToggleMerge)

  container.append(
    boldBtn,
    italicBtn,
    makeSeparator(),
    textColorInput,
    backgroundColorInput,
    makeSeparator(),
    borderBtn,
    makeSeparator(),
    alignLeftBtn,
    alignCenterBtn,
    alignRightBtn,
    makeSeparator(),
    alignTopBtn,
    alignMiddleBtn,
    alignBottomBtn,
    makeSeparator(),
    mergeBtn
  )

  return {
    setActiveStyle(style: CellStyle, isMerged: boolean): void {
      setPressed(boldBtn, Boolean(style.bold))
      setPressed(italicBtn, Boolean(style.italic))
      const hasFullBorder = Boolean(
        style.borders?.top && style.borders?.right && style.borders?.bottom && style.borders?.left
      )
      setPressed(borderBtn, hasFullBorder)
      setPressed(alignLeftBtn, style.hAlign === 'left')
      setPressed(alignCenterBtn, style.hAlign === 'center')
      setPressed(alignRightBtn, style.hAlign === 'right')
      setPressed(alignTopBtn, style.vAlign === 'top')
      setPressed(alignMiddleBtn, style.vAlign === 'middle')
      setPressed(alignBottomBtn, style.vAlign === 'bottom')
      setPressed(mergeBtn, isMerged)
      if (style.textColor) textColorInput.value = style.textColor
      if (style.backgroundColor) backgroundColorInput.value = style.backgroundColor
    }
  }
}
