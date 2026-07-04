export interface FindReplaceHandlers {
  onQueryChange(query: string): void
  onNext(): void
  onPrevious(): void
  onReplace(query: string, replacement: string): void
  onReplaceAll(query: string, replacement: string): void
}

export interface FindReplaceBar {
  show(withReplace: boolean): void
  hide(): void
  setStatus(text: string): void
}

/** Floating localizar-e-substituir overlay -- a dumb UI component, no engine coupling. */
export function mountFindReplaceBar(container: HTMLElement, handlers: FindReplaceHandlers): FindReplaceBar {
  const panel = document.createElement('div')
  panel.style.position = 'absolute'
  panel.style.top = '8px'
  panel.style.right = '8px'
  panel.style.zIndex = '10'
  panel.style.display = 'none'
  panel.style.flexDirection = 'column'
  panel.style.gap = '6px'
  panel.style.padding = '8px'
  panel.style.background = '#ffffff'
  panel.style.border = '1px solid #dcdfe3'
  panel.style.borderRadius = '6px'
  panel.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)'
  panel.style.font = '13px sans-serif'

  const findRow = document.createElement('div')
  findRow.style.display = 'flex'
  findRow.style.alignItems = 'center'
  findRow.style.gap = '6px'

  const queryInput = document.createElement('input')
  queryInput.type = 'text'
  queryInput.placeholder = 'Localizar'
  queryInput.spellcheck = false
  queryInput.style.width = '160px'

  const prevBtn = document.createElement('button')
  prevBtn.textContent = '◀'
  prevBtn.title = 'Anterior'
  prevBtn.type = 'button'

  const nextBtn = document.createElement('button')
  nextBtn.textContent = '▶'
  nextBtn.title = 'Próximo'
  nextBtn.type = 'button'

  const status = document.createElement('span')
  status.style.color = '#666666'
  status.style.minWidth = '52px'
  status.style.textAlign = 'center'

  const toggleReplaceBtn = document.createElement('button')
  toggleReplaceBtn.textContent = '⋯'
  toggleReplaceBtn.title = 'Substituir'
  toggleReplaceBtn.type = 'button'

  const closeBtn = document.createElement('button')
  closeBtn.textContent = '×'
  closeBtn.title = 'Fechar'
  closeBtn.type = 'button'

  findRow.append(queryInput, prevBtn, nextBtn, status, toggleReplaceBtn, closeBtn)

  const replaceRow = document.createElement('div')
  replaceRow.style.display = 'none'
  replaceRow.style.alignItems = 'center'
  replaceRow.style.gap = '6px'

  const replacementInput = document.createElement('input')
  replacementInput.type = 'text'
  replacementInput.placeholder = 'Substituir por'
  replacementInput.spellcheck = false
  replacementInput.style.width = '160px'

  const replaceBtn = document.createElement('button')
  replaceBtn.textContent = 'Substituir'
  replaceBtn.type = 'button'

  const replaceAllBtn = document.createElement('button')
  replaceAllBtn.textContent = 'Substituir tudo'
  replaceAllBtn.type = 'button'

  replaceRow.append(replacementInput, replaceBtn, replaceAllBtn)

  panel.append(findRow, replaceRow)
  container.appendChild(panel)

  function hide(): void {
    panel.style.display = 'none'
  }

  function show(withReplace: boolean): void {
    panel.style.display = 'flex'
    replaceRow.style.display = withReplace ? 'flex' : 'none'
    queryInput.focus()
    queryInput.select()
  }

  function handleEscapeKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      hide()
    }
    e.stopPropagation()
  }

  queryInput.addEventListener('input', () => handlers.onQueryChange(queryInput.value))
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) handlers.onPrevious()
      else handlers.onNext()
      return
    }
    handleEscapeKey(e)
  })
  replacementInput.addEventListener('keydown', handleEscapeKey)

  prevBtn.addEventListener('click', () => handlers.onPrevious())
  nextBtn.addEventListener('click', () => handlers.onNext())
  closeBtn.addEventListener('click', () => hide())
  toggleReplaceBtn.addEventListener('click', () => {
    replaceRow.style.display = replaceRow.style.display === 'none' ? 'flex' : 'none'
  })
  replaceBtn.addEventListener('click', () => handlers.onReplace(queryInput.value, replacementInput.value))
  replaceAllBtn.addEventListener('click', () => handlers.onReplaceAll(queryInput.value, replacementInput.value))

  return {
    show,
    hide,
    setStatus(text: string): void {
      status.textContent = text
    }
  }
}
