import { app, ipcMain, shell, systemPreferences } from 'electron'

const SCREEN_CAPTURE_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export function registerScreenPermissionHandlers(): void {
  ipcMain.handle('screen-capture:status', () => {
    if (process.platform !== 'darwin') return 'granted'
    return systemPreferences.getMediaAccessStatus('screen')
  })

  ipcMain.handle('screen-capture:open-settings', async () => {
    if (process.platform !== 'darwin') return false
    await shell.openExternal(SCREEN_CAPTURE_SETTINGS_URL)
    return true
  })

  ipcMain.handle('app:relaunch', () => {
    setImmediate(() => {
      app.relaunch()
      app.exit(0)
    })
    return true
  })
}
