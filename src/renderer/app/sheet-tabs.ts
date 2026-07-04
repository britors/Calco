import type { SheetInfo } from '../engine/engine-adapter'

export interface SheetTabsHandlers {
  onSelect(id: number): void
  onAdd(): void
  onRename(id: number, name: string): void
  onDelete(id: number): void
}

export interface SheetTabsBar {
  setSheets(sheets: SheetInfo[], activeId: number): void
}

/** Sheet tab bar -- a dumb UI component, no engine coupling. */
export function mountSheetTabs(container: HTMLElement, handlers: SheetTabsHandlers): SheetTabsBar {
  container.style.display = 'flex'
  container.style.alignItems = 'stretch'
  container.style.height = '30px'
  container.style.background = '#f8f9fa'
  container.style.borderTop = '1px solid #dcdfe3'
  container.style.overflowX = 'auto'
  container.style.font = '12px sans-serif'

  const tabsRow = document.createElement('div')
  tabsRow.style.display = 'flex'
  tabsRow.style.alignItems = 'stretch'

  const addButton = document.createElement('button')
  addButton.textContent = '+'
  addButton.title = 'Nova planilha'
  addButton.style.border = 'none'
  addButton.style.background = 'transparent'
  addButton.style.cursor = 'pointer'
  addButton.style.width = '30px'
  addButton.style.flexShrink = '0'
  addButton.style.fontSize = '16px'
  addButton.style.color = '#333333'
  addButton.addEventListener('click', () => handlers.onAdd())

  container.appendChild(tabsRow)
  container.appendChild(addButton)

  function buildTab(sheet: SheetInfo, isActive: boolean, canDelete: boolean): HTMLElement {
    const tab = document.createElement('div')
    tab.style.display = 'flex'
    tab.style.alignItems = 'center'
    tab.style.gap = '6px'
    tab.style.padding = '0 10px'
    tab.style.cursor = 'pointer'
    tab.style.borderRight = '1px solid #dcdfe3'
    tab.style.color = isActive ? '#1a1a1a' : '#555555'
    tab.style.background = isActive ? '#ffffff' : 'transparent'
    tab.style.borderBottom = isActive ? '2px solid #4fbf67' : '2px solid transparent'
    tab.style.userSelect = 'none'
    tab.style.whiteSpace = 'nowrap'

    const label = document.createElement('span')
    label.textContent = sheet.name

    const closeBtn = document.createElement('span')
    closeBtn.textContent = '×'
    closeBtn.style.color = '#999999'
    closeBtn.style.visibility = canDelete ? 'visible' : 'hidden'
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      handlers.onDelete(sheet.id)
    })

    tab.addEventListener('click', () => {
      if (!isActive) handlers.onSelect(sheet.id)
    })

    tab.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      beginRename(tab, label, sheet)
    })

    tab.appendChild(label)
    tab.appendChild(closeBtn)
    return tab
  }

  function beginRename(tab: HTMLElement, label: HTMLElement, sheet: SheetInfo): void {
    const input = document.createElement('input')
    input.type = 'text'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.value = sheet.name
    input.style.width = `${Math.max(50, sheet.name.length * 8)}px`
    input.style.font = 'inherit'

    let done = false

    function restoreLabel(): void {
      if (input.parentElement === tab) tab.replaceChild(label, input)
    }

    function finish(shouldRename: boolean): void {
      if (done) return
      done = true
      if (shouldRename) {
        const newName = input.value.trim()
        if (newName && newName !== sheet.name) {
          handlers.onRename(sheet.id, newName) // parent rebuilds the whole bar afterward
          return
        }
      }
      restoreLabel()
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
      e.stopPropagation()
    })
    input.addEventListener('blur', () => finish(true))

    tab.replaceChild(input, label)
    input.focus()
    input.select()
  }

  function setSheets(sheets: SheetInfo[], activeId: number): void {
    tabsRow.innerHTML = ''
    for (const sheet of sheets) {
      tabsRow.appendChild(buildTab(sheet, sheet.id === activeId, sheets.length > 1))
    }
  }

  return { setSheets }
}
