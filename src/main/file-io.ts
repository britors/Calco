import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { IPC_CHANNELS, type OpenResult, type SaveResult } from '@shared/ipc'

const CALCO_FILTERS = [{ name: 'Calco', extensions: ['calco'] }]

// export/getRecent are out of scope this milestone (xlsx/csv import-export,
// recent-files list are later work).
const NOT_IMPLEMENTED: SaveResult = { ok: false, message: 'Não implementado nesta versão.' }

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

  ipcMain.handle(IPC_CHANNELS.fileExport, async () => NOT_IMPLEMENTED)
  ipcMain.handle(IPC_CHANNELS.fileGetRecent, async () => [])
}
