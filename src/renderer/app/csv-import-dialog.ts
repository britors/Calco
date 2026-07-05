import { CSV_DELIMITERS, CSV_ENCODINGS, type CsvEncoding } from '../formats/csv-format'

export interface CsvImportChoice {
  delimiter: string
  encoding: CsvEncoding
}

export interface CsvImportDialog {
  /** Shows the dialog; resolves the chosen delimiter/encoding, or null if cancelled. */
  open(): Promise<CsvImportChoice | null>
}

function buildSelectField(
  labelText: string,
  options: { value: string; label: string }[]
): { field: HTMLDivElement; select: HTMLSelectElement } {
  const field = document.createElement('div')
  field.style.marginBottom = '14px'

  const label = document.createElement('label')
  label.textContent = labelText
  label.style.display = 'block'
  label.style.marginBottom = '4px'
  label.style.color = '#555555'

  const select = document.createElement('select')
  select.style.width = '100%'
  select.style.padding = '5px'
  select.style.font = 'inherit'
  for (const opt of options) {
    const option = document.createElement('option')
    option.value = opt.value
    option.textContent = opt.label
    select.appendChild(option)
  }

  field.append(label, select)
  return { field, select }
}

/** Modal gating a CSV import on delimiter + encoding choice (spec section 5). No engine coupling. */
export function mountCsvImportDialog(container: HTMLElement): CsvImportDialog {
  const backdrop = document.createElement('div')
  backdrop.style.position = 'fixed' // covers the whole window regardless of the container's own positioning
  backdrop.style.inset = '0'
  backdrop.style.background = 'rgba(0, 0, 0, 0.35)'
  backdrop.style.display = 'none'
  backdrop.style.alignItems = 'center'
  backdrop.style.justifyContent = 'center'
  backdrop.style.zIndex = '100'

  const panel = document.createElement('div')
  panel.style.background = '#ffffff'
  panel.style.borderRadius = '8px'
  panel.style.padding = '20px'
  panel.style.width = '320px'
  panel.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.25)'
  panel.style.font = '13px sans-serif'
  panel.style.color = '#1a1a1a'

  const title = document.createElement('div')
  title.textContent = 'Importar CSV'
  title.style.fontWeight = 'bold'
  title.style.fontSize = '15px'
  title.style.marginBottom = '14px'

  const { field: delimiterField, select: delimiterSelect } = buildSelectField(
    'Separador de colunas',
    CSV_DELIMITERS
  )
  const { field: encodingField, select: encodingSelect } = buildSelectField(
    'Codificação do arquivo',
    CSV_ENCODINGS
  )

  const buttonRow = document.createElement('div')
  buttonRow.style.display = 'flex'
  buttonRow.style.justifyContent = 'flex-end'
  buttonRow.style.gap = '8px'
  buttonRow.style.marginTop = '4px'

  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.textContent = 'Cancelar'

  const confirmBtn = document.createElement('button')
  confirmBtn.type = 'button'
  confirmBtn.textContent = 'Importar'

  buttonRow.append(cancelBtn, confirmBtn)
  panel.append(title, delimiterField, encodingField, buttonRow)
  backdrop.appendChild(panel)
  container.appendChild(backdrop)

  let resolveFn: ((choice: CsvImportChoice | null) => void) | null = null

  function close(result: CsvImportChoice | null): void {
    backdrop.style.display = 'none'
    resolveFn?.(result)
    resolveFn = null
  }

  cancelBtn.addEventListener('click', () => close(null))
  confirmBtn.addEventListener('click', () =>
    close({ delimiter: delimiterSelect.value, encoding: encodingSelect.value as CsvEncoding })
  )
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close(null)
  })
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close(null)
    }
    e.stopPropagation()
  })

  return {
    open(): Promise<CsvImportChoice | null> {
      return new Promise((resolve) => {
        resolveFn = resolve
        backdrop.style.display = 'flex'
        confirmBtn.focus()
      })
    }
  }
}
