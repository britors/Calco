export interface FormulaBarHandlers {
  onCommit(value: string): void
}

export interface FormulaBar {
  setName(name: string): void
  setValue(value: string): void
}

/** Name box + editable formula content -- a dumb UI component, no engine coupling. */
export function mountFormulaBar(container: HTMLElement, handlers: FormulaBarHandlers): FormulaBar {
  container.style.display = 'flex'
  container.style.alignItems = 'stretch'
  container.style.height = '32px'
  container.style.background = '#f8f9fa'
  container.style.borderBottom = '1px solid #dcdfe3'
  container.style.font = '13px sans-serif'

  const nameBox = document.createElement('div')
  nameBox.style.width = '80px'
  nameBox.style.flexShrink = '0'
  nameBox.style.display = 'flex'
  nameBox.style.alignItems = 'center'
  nameBox.style.justifyContent = 'center'
  nameBox.style.borderRight = '1px solid #dcdfe3'
  nameBox.style.color = '#333333'
  nameBox.style.userSelect = 'none'

  const input = document.createElement('input')
  input.type = 'text'
  input.spellcheck = false
  input.autocomplete = 'off'
  input.style.flex = '1'
  input.style.border = 'none'
  input.style.outline = 'none'
  input.style.padding = '0 8px'
  input.style.background = 'transparent'
  input.style.font = 'inherit'
  input.style.color = '#1a1a1a'

  let lastSetValue = ''

  function commit(): void {
    handlers.onCommit(input.value)
  }

  function revert(): void {
    input.value = lastSetValue
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      input.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      revert()
      input.blur()
    }
  })
  input.addEventListener('blur', () => {
    if (input.value !== lastSetValue) commit()
  })

  container.appendChild(nameBox)
  container.appendChild(input)

  return {
    setName(name: string): void {
      nameBox.textContent = name
    },
    setValue(value: string): void {
      // Never clobber what the user is actively typing (e.g. a redraw from
      // unrelated scrolling shouldn't overwrite an in-progress edit).
      if (document.activeElement === input) return
      lastSetValue = value
      input.value = value
    }
  }
}
