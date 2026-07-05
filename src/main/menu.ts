import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC_CHANNELS, type MenuAction } from '@shared/ipc'

// Minimal native menu -- just enough to trigger file operations and prove the
// menu:action -> onMenuAction IPC channel end-to-end. Full pt-BR menu content
// (spec section 7) is a later milestone.
export function buildMenu(win: BrowserWindow): void {
  const send = (action: MenuAction): void => {
    win.webContents.send(IPC_CHANNELS.menuAction, action)
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Novo', accelerator: 'CmdOrCtrl+N', click: () => send({ type: 'new' }) },
        { label: 'Abrir...', accelerator: 'CmdOrCtrl+O', click: () => send({ type: 'open' }) },
        { label: 'Salvar', accelerator: 'CmdOrCtrl+S', click: () => send({ type: 'save' }) },
        {
          label: 'Salvar como...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send({ type: 'saveAs' })
        },
        { type: 'separator' },
        {
          label: 'Importar',
          submenu: [
            { label: 'Excel (.xlsx)...', click: () => send({ type: 'import', format: 'xlsx' }) },
            { label: 'CSV (.csv)...', click: () => send({ type: 'import', format: 'csv' }) }
          ]
        },
        {
          label: 'Exportar',
          submenu: [
            { label: 'Excel (.xlsx)...', click: () => send({ type: 'export', format: 'xlsx' }) },
            { label: 'CSV (.csv)...', click: () => send({ type: 'export', format: 'csv' }) }
          ]
        }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', accelerator: 'CmdOrCtrl+Z', click: () => send({ type: 'undo' }) },
        { label: 'Refazer', accelerator: 'CmdOrCtrl+Y', click: () => send({ type: 'redo' }) }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [{ label: 'Sobre o Calco', click: () => send({ type: 'about' }) }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
