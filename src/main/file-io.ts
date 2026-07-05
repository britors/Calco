import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { IPC_CHANNELS, type ExportFormat, type ImportFormat, type OpenResult, type SaveResult } from '@shared/ipc'

const CALCO_FILTERS = [{ name: 'Calco', extensions: ['calco'] }]

const IMPORT_FILTERS: Record<ImportFormat, Electron.FileFilter[]> = {
  xlsx: [{ name: 'Excel', extensions: ['xlsx'] }],
  csv: [{ name: 'CSV', extensions: ['csv'] }]
}

const EXPORT_FILTERS: Record<ExportFormat, Electron.FileFilter[]> = IMPORT_FILTERS

// getRecent is out of scope this milestone (recent-files list is later work).

export function registerFileIoHandlers(win: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.fileOpen, async (): Promise<OpenResult | null> => {
    const result = await dialog.showOpenDialog(win, {
      filters: CALCO_FILTERS,
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    const buffer = await readFile(path)
    return { path, bytes: new Uint8Array(buffer) }
  })

  ipcMain.handle(
    IPC_CHANNELS.fileSave,
    async (_event, bytes: Uint8Array, path: string): Promise<SaveResult> => {
      try {
        await writeFile(path, bytes)
        return { ok: true, path }
      } catch (err) {
        return { ok: false, message: String(err) }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.fileSaveAs, async (_event, bytes: Uint8Array): Promise<SaveResult> => {
    const result = await dialog.showSaveDialog(win, { filters: CALCO_FILTERS })
    if (result.canceled || !result.filePath) {
      return { ok: false, message: 'Cancelado' }
    }
    try {
      await writeFile(result.filePath, bytes)
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { ok: false, message: String(err) }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.fileImport,
    async (_event, format: ImportFormat): Promise<OpenResult | null> => {
      const result = await dialog.showOpenDialog(win, {
        filters: IMPORT_FILTERS[format],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const path = result.filePaths[0]
      const buffer = await readFile(path)
      return { path, bytes: new Uint8Array(buffer) }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.fileExport,
    async (_event, bytes: Uint8Array, format: ExportFormat): Promise<SaveResult> => {
      const result = await dialog.showSaveDialog(win, {
        filters: EXPORT_FILTERS[format],
        defaultPath: `planilha.${format}`
      })
      if (result.canceled || !result.filePath) {
        return { ok: false, message: 'Cancelado' }
      }
      try {
        await writeFile(result.filePath, bytes)
        return { ok: true, path: result.filePath }
      } catch (err) {
        return { ok: false, message: String(err) }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.fileGetRecent, async () => [])
}
