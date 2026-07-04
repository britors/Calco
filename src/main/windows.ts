import { BrowserWindow, shell } from 'electron'
import path from 'node:path'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:'])

function safeProtocolOf(url: string): string | null {
  try {
    return new URL(url).protocol
  } catch {
    return null
  }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    const protocol = safeProtocolOf(url)
    if (protocol && ALLOWED_EXTERNAL_PROTOCOLS.has(protocol)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}
