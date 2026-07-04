import { BrowserWindow, shell } from 'electron'
import path from 'node:path'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:'])
const ICON_PATH = path.join(__dirname, '..', 'icon.png')
const SPLASH_MIN_MS = 1200

function safeProtocolOf(url: string): string | null {
  try {
    return new URL(url).protocol
  } catch {
    return null
  }
}

let splashWindow: BrowserWindow | null = null
let splashShownAt = 0

/** Shows the branded splash window while the main window loads. */
export function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 340,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#0f1117',
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    splashWindow.loadURL(`${devServerUrl}/splash.html`)
  } else {
    splashWindow.loadFile(path.join(__dirname, '../renderer/splash.html'))
  }

  splashWindow.once('ready-to-show', () => {
    splashWindow?.show()
    splashShownAt = Date.now()
  })
  splashWindow.on('closed', () => {
    splashWindow = null
  })
}

/** Closes the splash (respecting a minimum display time) and runs `onDone`. */
function finishSplash(onDone: () => void): void {
  const elapsed = Date.now() - (splashShownAt || Date.now())
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed)
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
    onDone()
  }, wait)
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    icon: ICON_PATH,
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

  win.once('ready-to-show', () => {
    finishSplash(() => win.show())
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}
