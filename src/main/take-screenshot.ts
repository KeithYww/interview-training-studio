import { desktopCapturer, screen, systemPreferences } from 'electron'

export class ScreenshotCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScreenshotCaptureError'
  }
}

export async function takeScreenshot(): Promise<string> {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new ScreenshotCaptureError('offerGet 窗口尚未就绪，请重新打开应用后再试')
  }

  const macScreenPermission =
    process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted'

  // Get the primary display's size.
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    })
    const source = sources[0]
    if (!source || source.thumbnail.isEmpty()) {
      if (macScreenPermission === 'denied' || macScreenPermission === 'restricted') {
        throw new ScreenshotCaptureError(
          'macOS 仍拒绝当前 offerGet 读取屏幕。请确认“屏幕与系统音频录制”中的 offerGet 已开启，并点击“重启 offerGet”；若授权后仍提示，请重新安装已签名的最新版再授权。'
        )
      }
      throw new ScreenshotCaptureError(
        '没有获取到屏幕画面。请检查系统屏幕录制权限，然后完全退出并重新打开 offerGet'
      )
    }
    return source.thumbnail.toPNG().toString('base64')
  } catch (error) {
    if (error instanceof ScreenshotCaptureError) throw error
    console.error('Error taking screenshot:', error)
    if (macScreenPermission === 'denied' || macScreenPermission === 'restricted') {
      throw new ScreenshotCaptureError(
        'macOS 仍拒绝当前 offerGet 读取屏幕。请确认“屏幕与系统音频录制”中的 offerGet 已开启，并点击“重启 offerGet”；若授权后仍提示，请重新安装已签名的最新版再授权。'
      )
    }
    throw new ScreenshotCaptureError(
      `截屏失败：${error instanceof Error ? error.message : '无法读取屏幕画面'}`
    )
  }
}
