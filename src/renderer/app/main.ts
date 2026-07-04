import { EngineAdapter } from '../engine/engine-adapter'
import { mountGrid, type MountedGrid } from '../grid/grid'
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

let engine = new EngineAdapter()
let grid: MountedGrid = mountGrid(appRoot, engine)
let currentFilePath: string | null = null
let appVersion = ''

window.calco.app.getVersion().then((version) => {
  appVersion = version
  document.title = `Calco ${version}`
})

function loadDocument(doc: SerializedWorkbook, path: string | null): void {
  grid.destroy()
  engine = new EngineAdapter()
  engine.loadWorkbook(doc)
  grid = mountGrid(appRoot!, engine)
  currentFilePath = path
  document.title = path ? `Calco - ${path}` : `Calco ${appVersion}`
}

function handleNew(): void {
  grid.destroy()
  engine = new EngineAdapter()
  grid = mountGrid(appRoot!, engine)
  currentFilePath = null
  document.title = `Calco ${appVersion}`
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
