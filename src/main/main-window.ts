import { join } from 'node:path'
import { shell, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { reassertInterviewWindowOnTop } from './settings'

export function applyContentProtection(window: BrowserWindow, forceReset = false): void {
  if (!window || window.isDestroyed()) return

  if (forceReset && process.platform === 'win32') {
    window.setContentProtection(false)
  }

  window.setContentProtection(true)
}

export function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    hiddenInMissionControl: false,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Store reference to mainWindow globally
  global.mainWindow = mainWindow

  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    applyContentProtection(mainWindow)
    reassertInterviewWindowOnTop()
  })

  mainWindow.on('show', () => {
    applyContentProtection(mainWindow)
    reassertInterviewWindowOnTop()
  })
  mainWindow.on('restore', reassertInterviewWindowOnTop)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
