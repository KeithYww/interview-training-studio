import { app, dialog, ipcMain } from 'electron'

let interviewModeActive = false

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

/** Interview mode temporarily overrides the user's normal Dock/taskbar preference. */
export function setInterviewModeActive(active: boolean): void {
  interviewModeActive = active
  refreshAppIconVisibility()
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
