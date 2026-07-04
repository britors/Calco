import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { createMainWindow } from './windows'
import { buildMenu } from './menu'
import { registerFileIoHandlers } from './file-io'

app.whenReady().then(() => {
  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion())

  const win = createMainWindow()
  buildMenu(win)
  registerFileIoHandlers(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopened = createMainWindow()
      buildMenu(reopened)
      registerFileIoHandlers(reopened)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
