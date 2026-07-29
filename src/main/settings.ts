import { app, dialog, ipcMain } from 'electron'

let interviewModeActive = false
let interviewWindowGuard: NodeJS.Timeout | null = null

const INTERVIEW_WINDOW_GUARD_INTERVAL_MS = 1_000

ipcMain.handle('getAppSettings', () => {
  return settings
})

ipcMain.handle('updateAppSettings', (_event, _settings) => {
  Object.assign(settings, _settings)
  if ('opacity' in _settings && typeof _settings.opacity === 'number') {
    const opacity = Math.min(1, Math.max(0.5, _settings.opacity))
    settings.opacity = opacity
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.setOpacity(opacity)
    }
  }
  if ('hideDockIcon' in _settings) {
    refreshAppIconVisibility()
  }
})

/** Show/hide the macOS Dock icon or Windows taskbar entry. */
export function applyDockVisibility(hidden: boolean): void {
  if (process.platform === 'darwin') {
    if (hidden) {
      app.dock?.hide()
    } else {
      app.dock?.show()
    }
    return
  }
  if (process.platform === 'win32' && global.mainWindow && !global.mainWindow.isDestroyed()) {
    global.mainWindow.setSkipTaskbar(hidden)
  }
}

function refreshAppIconVisibility(): void {
  applyDockVisibility(settings.hideDockIcon || interviewModeActive)
}

function stopInterviewWindowGuard(): void {
  if (!interviewWindowGuard) return
  clearInterval(interviewWindowGuard)
  interviewWindowGuard = null
}

function enforceInterviewWindowOnTop(moveToTop = false): void {
  const mainWindow = global.mainWindow
  if (!interviewModeActive || !mainWindow || mainWindow.isDestroyed()) return

  // Reassert the native z-order because macOS can demote a transparent window
  // after another app enters full screen or the assistant is hidden and shown.
  mainWindow.setAlwaysOnTop(true, 'screen-saver', process.platform === 'darwin' ? 1 : 0)
  if (moveToTop && mainWindow.isVisible()) {
    mainWindow.moveTop()
  }
}

function startInterviewWindowGuard(): void {
  stopInterviewWindowGuard()
  interviewWindowGuard = setInterval(() => {
    enforceInterviewWindowOnTop(true)
  }, INTERVIEW_WINDOW_GUARD_INTERVAL_MS)
}

function refreshInterviewWindowBehavior(): void {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return

  if (interviewModeActive) {
    if (process.platform === 'darwin') {
      mainWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
    }
    enforceInterviewWindowOnTop(true)
    startInterviewWindowGuard()
    return
  }

  stopInterviewWindowGuard()
  mainWindow.setAlwaysOnTop(false)
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(false)
  }
}

/** Restore z-order after show/restore without activating or focusing the assistant. */
export function reassertInterviewWindowOnTop(): void {
  enforceInterviewWindowOnTop(true)
}

/** Interview mode temporarily overrides the user's normal Dock/taskbar preference. */
export function setInterviewModeActive(active: boolean): void {
  interviewModeActive = active
  refreshAppIconVisibility()
  refreshInterviewWindowBehavior()
}

ipcMain.handle('selectScreenshotDir', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: '选择截图保存目录'
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
})

export const settings = {
  opacity: 0.8,
  screenshotAutoSave: false,
  screenshotDir: '',
  hideDockIcon: false,
  audioInputDeviceId: '',
  audioOutputDeviceId: '',
  customPrompt: ''
}

export type AppSettings = typeof settings
