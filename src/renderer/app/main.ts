import { EngineAdapter } from '../engine/engine-adapter'
import { mountGrid, type MountedGrid } from '../grid/grid'
import { columnLabel } from '../grid/render'
import { findMatches, replaceAll, replaceInCell, type CellMatch } from '../grid/find-replace'
import { mountFormulaBar, type FormulaBar } from './formula-bar'
import { mountSheetTabs, type SheetTabsBar } from './sheet-tabs'
import { mountFindReplaceBar, type FindReplaceBar } from './find-replace-bar'
import { mountToolbar, type Toolbar } from './toolbar'
import { packCalcoFile, unpackCalcoFile } from '../formats/calco-format'
import type { CalcoAPI, MenuAction } from '@shared/ipc'
import type { CellStyle, SerializedWorkbook } from '@shared/model'

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

const toolbarRegion = document.createElement('div')
const formulaBarRegion = document.createElement('div')
const gridRegion = document.createElement('div')
gridRegion.style.flex = '1'
gridRegion.style.minHeight = '0' // flex children need this to size correctly with absolutely-positioned content
const tabsRegion = document.createElement('div')

appRoot.appendChild(toolbarRegion)
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

function applyStyleToSelection(patch: CellStyle): void {
  engine.applyStyle(grid.getSelectionRange(), patch)
  grid.refresh()
}

const toolbar: Toolbar = mountToolbar(toolbarRegion, {
  onToggleBold: () => {
    const current = engine.getCellStyle(lastActiveCell.row, lastActiveCell.col)
    applyStyleToSelection({ bold: !current.bold })
  },
  onToggleItalic: () => {
    const current = engine.getCellStyle(lastActiveCell.row, lastActiveCell.col)
    applyStyleToSelection({ italic: !current.italic })
  },
  onTextColor: (color) => applyStyleToSelection({ textColor: color }),
  onBackgroundColor: (color) => applyStyleToSelection({ backgroundColor: color }),
  onToggleBorder: () => {
    const current = engine.getCellStyle(lastActiveCell.row, lastActiveCell.col)
    const hasFullBorder = Boolean(
      current.borders?.top && current.borders?.right && current.borders?.bottom && current.borders?.left
    )
    const color = { color: '#000000' }
    applyStyleToSelection({
      borders: hasFullBorder
        ? { top: undefined, right: undefined, bottom: undefined, left: undefined }
        : { top: color, right: color, bottom: color, left: color }
    })
  },
  onAlignH: (align) => applyStyleToSelection({ hAlign: align }),
  onAlignV: (align) => applyStyleToSelection({ vAlign: align }),
  onToggleMerge: () => {
    const existingMerge = engine.findMergeContaining(lastActiveCell.row, lastActiveCell.col)
    if (existingMerge) engine.unmergeAt(lastActiveCell.row, lastActiveCell.col)
    else engine.mergeRange(grid.getSelectionRange())
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
      toolbar.setActiveStyle(engine.getCellStyle(row, col), engine.findMergeContaining(row, col) !== undefined)
    }
  })
}

grid = mountGridWithHandlers()
refreshSheetTabs()

let matches: CellMatch[] = []
let matchIndex = -1

function updateStatus(): void {
  findReplaceBar.setStatus(matches.length === 0 ? '0/0' : `${matchIndex + 1}/${matches.length}`)
}

function jumpToCurrentMatch(): void {
  if (matchIndex >= 0) {
    const match = matches[matchIndex]
    grid.selectCell(match.row, match.col)
  }
}

function recomputeMatches(query: string): void {
  matches = findMatches(engine, query)
  matchIndex = matches.length > 0 ? 0 : -1
  jumpToCurrentMatch()
  updateStatus()
}

/** After a replace, the edited cell usually drops out of the match list -- keeping
 *  the same numeric index (clamped) in the freshly recomputed list naturally lands
 *  on what was the *next* match, giving an "advance after replace" feel for free. */
function recomputeMatchesKeepingIndex(query: string): void {
  matches = findMatches(engine, query)
  if (matches.length === 0) matchIndex = -1
  else if (matchIndex >= matches.length) matchIndex = 0
  jumpToCurrentMatch()
  updateStatus()
}

const findReplaceBar: FindReplaceBar = mountFindReplaceBar(gridRegion, {
  onQueryChange: (query) => recomputeMatches(query),
  onNext: () => {
    if (matches.length === 0) return
    matchIndex = (matchIndex + 1) % matches.length
    jumpToCurrentMatch()
    updateStatus()
  },
  onPrevious: () => {
    if (matches.length === 0) return
    matchIndex = (matchIndex - 1 + matches.length) % matches.length
    jumpToCurrentMatch()
    updateStatus()
  },
  onReplace: (query, replacement) => {
    if (matchIndex < 0) return
    const match = matches[matchIndex]
    replaceInCell(engine, match.row, match.col, query, replacement)
    grid.refresh()
    recomputeMatchesKeepingIndex(query)
  },
  onReplaceAll: (query, replacement) => {
    const count = replaceAll(engine, query, replacement)
    grid.refresh()
    recomputeMatches(query)
    findReplaceBar.setStatus(`${count} substituídas`)
  }
})

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return
  const key = e.key.toLowerCase()
  if (key === 'f') {
    e.preventDefault()
    findReplaceBar.show(false)
  } else if (key === 'h') {
    e.preventDefault()
    findReplaceBar.show(true)
  }
})

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
