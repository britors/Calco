import { EngineAdapter } from '../engine/engine-adapter'
import { mountGrid, type MountedGrid } from '../grid/grid'
import { columnLabel } from '../grid/render'
import { mountFormulaBar, type FormulaBar } from './formula-bar'
import { mountSheetTabs, type SheetTabsBar } from './sheet-tabs'
import { packCalcoFile, unpackCalcoFile } from '../formats/calco-format'
import type { CalcoAPI, MenuAction } from '@shared/ipc'
import type { SerializedWorkbook } from '@shared/model'

declare global {
  interface Window {
    calco: CalcoAPI
  }
}

const appRoot = document.getElementById('app')
if (!appRoot) throw new Error('#app root element missing')

appRoot.style.display = 'flex'
appRoot.style.flexDirection = 'column'
appRoot.style.height = '100%'

const formulaBarRegion = document.createElement('div')
const gridRegion = document.createElement('div')
gridRegion.style.flex = '1'
gridRegion.style.minHeight = '0' // flex children need this to size correctly with absolutely-positioned content
const tabsRegion = document.createElement('div')

appRoot.appendChild(formulaBarRegion)
appRoot.appendChild(gridRegion)
appRoot.appendChild(tabsRegion)

let engine = new EngineAdapter()
let grid: MountedGrid
let lastActiveCell = { row: 0, col: 0 }
let currentFilePath: string | null = null
let appVersion = ''

const formulaBar: FormulaBar = mountFormulaBar(formulaBarRegion, {
  onCommit: (value) => {
    engine.setCellContent(lastActiveCell.row, lastActiveCell.col, value)
    grid.refresh()
  }
})

const sheetTabs: SheetTabsBar = mountSheetTabs(tabsRegion, {
  onSelect: (id) => {
    engine.setActiveSheetId(id)
    grid.refresh()
    refreshSheetTabs()
  },
  onAdd: () => {
    const id = engine.addSheet()
    engine.setActiveSheetId(id)
    grid.refresh()
    refreshSheetTabs()
  },
  onRename: (id, name) => {
    try {
      engine.renameSheet(id, name)
    } catch {
      // e.g. duplicate name -- ignored, refreshSheetTabs redraws with the unchanged name
    }
    refreshSheetTabs()
  },
  onDelete: (id) => {
    engine.removeSheet(id)
    grid.refresh()
    refreshSheetTabs()
  }
})

function refreshSheetTabs(): void {
  sheetTabs.setSheets(engine.listSheets(), engine.getActiveSheetId())
}

function mountGridWithHandlers(): MountedGrid {
  return mountGrid(gridRegion, engine, {
    onActiveCellChange: (row, col) => {
      lastActiveCell = { row, col }
      formulaBar.setName(`${columnLabel(col)}${row + 1}`)
      formulaBar.setValue(engine.getCellSnapshot(row, col).raw)
    }
  })
}

grid = mountGridWithHandlers()
refreshSheetTabs()

window.calco.app.getVersion().then((version) => {
  appVersion = version
  document.title = `Calco ${version}`
})

function loadDocument(doc: SerializedWorkbook, path: string | null): void {
  grid.destroy()
  engine = new EngineAdapter()
  engine.loadWorkbook(doc)
  grid = mountGridWithHandlers()
  currentFilePath = path
  document.title = path ? `Calco - ${path}` : `Calco ${appVersion}`
  refreshSheetTabs()
}

function handleNew(): void {
  grid.destroy()
  engine = new EngineAdapter()
  grid = mountGridWithHandlers()
  currentFilePath = null
  document.title = `Calco ${appVersion}`
  refreshSheetTabs()
}

async function handleOpen(): Promise<void> {
  const result = await window.calco.file.open()
  if (!result) return
  const doc = unpackCalcoFile(result.bytes)
  loadDocument(doc, result.path)
}

async function handleSave(): Promise<void> {
  const doc = engine.serializeWorkbook()
  const bytes = packCalcoFile(doc, appVersion)
  if (currentFilePath) {
    await window.calco.file.save(bytes, currentFilePath)
  } else {
    const result = await window.calco.file.saveAs(bytes)
    if (result.ok && result.path) {
      currentFilePath = result.path
      document.title = `Calco - ${result.path}`
    }
  }
}

async function handleSaveAs(): Promise<void> {
  const doc = engine.serializeWorkbook()
  const bytes = packCalcoFile(doc, appVersion)
  const result = await window.calco.file.saveAs(bytes)
  if (result.ok && result.path) {
    currentFilePath = result.path
    document.title = `Calco - ${result.path}`
  }
}

function handleUndo(): void {
  engine.undo()
  grid.refresh()
}

function handleRedo(): void {
  engine.redo()
  grid.refresh()
}

window.calco.app.onMenuAction((action: MenuAction) => {
  if (action.type === 'new') handleNew()
  else if (action.type === 'open') void handleOpen()
  else if (action.type === 'save') void handleSave()
  else if (action.type === 'saveAs') void handleSaveAs()
  else if (action.type === 'undo') handleUndo()
  else if (action.type === 'redo') handleRedo()
})
