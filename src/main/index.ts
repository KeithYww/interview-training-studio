import 'dotenv/config'
import { app, BrowserWindow, desktopCapturer, globalShortcut, nativeImage, session } from 'electron'
import icon from '../../resources/icon.png?asset'

type AbortLikeError = {
  name?: string
  code?: string
  message?: unknown
}

// Swallow AbortError from user-initiated stream cancellations to keep console clean
function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const err = error as AbortLikeError
  const message = typeof err.message === 'string' ? err.message : ''
  return err.name === 'AbortError' || err.code === 'ABORT_ERR' || /aborted/i.test(message)
}

process.on('unhandledRejection', (error) => {
  if (isAbortError(error)) return
  console.error(error)
})

process.on('uncaughtException', (error) => {
  if (isAbortError(error)) return
  console.error(error)
})
import { electronApp, optimizer } from '@electron-toolkit/utils'
import './shortcuts'
import './transcription'
import './offerget-api'
import { createWindow } from './main-window'
import { initAutoUpdater } from './auto-updater'
import { applyDockVisibility } from './settings'
import { registerScreenPermissionHandlers } from './screen-permissions'

app.setName('offerGet')
process.title = 'offerGet'
registerScreenPermissionHandlers()

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.offerget.app')

  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(icon))
  }

  // A standard desktop app must remain visible in the Dock/taskbar.
  applyDockVisibility(false)

  // Keep macOS on its native system picker. The forced CoreAudio loopback path
  // introduced with Electron 39 can capture simple system sounds but misses
  // output from some conferencing clients (including Tencent Meeting).
  // Windows continues to use Electron's loopback capture without a picker.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        if (sources.length > 0) {
          callback({
            video: sources[0],
            ...(process.platform === 'win32' ? { audio: 'loopback' as const } : {})
          })
        }
      })
    },
    { useSystemPicker: process.platform === 'darwin' }
  )

  // Auto-approve microphone access so users can enumerate and select audio input devices
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (['media', 'microphone', 'audio', 'display-capture'].includes(permission)) {
      callback(true)
    } else {
      callback(false)
    }
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ['media', 'microphone', 'audio', 'display-capture'].includes(permission)
  )

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // Configure auto-updater
  initAutoUpdater()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (global.mainWindow && !global.mainWindow.isVisible()) {
      global.mainWindow.show()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // Unregister all shortcuts when there is no window left
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
