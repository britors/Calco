import { clipboard, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'

/** Raw OS clipboard I/O -- the renderer builds the TSV/HTML text, this just writes/reads it. */
export function registerClipboardHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.clipboardWriteHtml, (_event, html: string, text: string) => {
    clipboard.write({ html, text })
  })

  ipcMain.handle(IPC_CHANNELS.clipboardReadText, () => clipboard.readText())
}
