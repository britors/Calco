import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type CalcoAPI, type MenuAction } from '@shared/ipc'

const api: CalcoAPI = {
  file: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.fileOpen),
    save: (bytes, path) => ipcRenderer.invoke(IPC_CHANNELS.fileSave, bytes, path),
    saveAs: (bytes) => ipcRenderer.invoke(IPC_CHANNELS.fileSaveAs, bytes),
    import: (format) => ipcRenderer.invoke(IPC_CHANNELS.fileImport, format),
    export: (bytes, format) => ipcRenderer.invoke(IPC_CHANNELS.fileExport, bytes, format),
    getRecent: () => ipcRenderer.invoke(IPC_CHANNELS.fileGetRecent)
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
    onMenuAction: (cb: (action: MenuAction) => void) => {
      ipcRenderer.on(IPC_CHANNELS.menuAction, (_event, action: MenuAction) => cb(action))
    }
  },
  clipboard: {
    writeHtml: (html, text) => ipcRenderer.invoke(IPC_CHANNELS.clipboardWriteHtml, html, text),
    readText: () => ipcRenderer.invoke(IPC_CHANNELS.clipboardReadText)
  }
}

contextBridge.exposeInMainWorld('calco', api)
