import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type CalcoAPI, type MenuAction } from '@shared/ipc'

const api: CalcoAPI = {
  file: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.fileOpen),
    save: (bytes, path) => ipcRenderer.invoke(IPC_CHANNELS.fileSave, bytes, path),
    saveAs: (bytes) => ipcRenderer.invoke(IPC_CHANNELS.fileSaveAs, bytes),
    export: (doc, format) => ipcRenderer.invoke(IPC_CHANNELS.fileExport, doc, format),
    getRecent: () => ipcRenderer.invoke(IPC_CHANNELS.fileGetRecent)
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
    onMenuAction: (cb: (action: MenuAction) => void) => {
      ipcRenderer.on(IPC_CHANNELS.menuAction, (_event, action: MenuAction) => cb(action))
    }
  }
}

contextBridge.exposeInMainWorld('calco', api)
