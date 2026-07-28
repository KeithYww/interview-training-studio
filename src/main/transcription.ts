import { ipcMain } from 'electron'
import WebSocket from 'ws'
import { offergetApi } from './offerget-api'

let accumulatedText = ''
let finalText = ''
let partialText = ''
let socket: WebSocket | null = null
let ready = false
let stopping = false
let pendingAudio: Buffer[] = []
let pendingAudioBytes = 0
const MAX_PENDING_AUDIO_BYTES = 128 * 1024
const QUESTION_SETTLE_MS = 1_400
let pendingQuestion = ''
let questionTimer: ReturnType<typeof setTimeout> | null = null
let finalTranscriptHandler: ((question: string) => void | Promise<void>) | null = null

export function setFinalTranscriptHandler(
  handler: ((question: string) => void | Promise<void>) | null
): void {
  finalTranscriptHandler = handler
}

function cancelPendingQuestion(): void {
  if (questionTimer) clearTimeout(questionTimer)
  questionTimer = null
  pendingQuestion = ''
}

function queueFinalQuestion(text: string): void {
  const normalized = text.trim()
  if (!normalized) return
  pendingQuestion = [pendingQuestion, normalized].filter(Boolean).join('，')
  if (questionTimer) clearTimeout(questionTimer)
  questionTimer = setTimeout(() => {
    const question = pendingQuestion
    questionTimer = null
    pendingQuestion = ''
    if (!question || !finalTranscriptHandler) return
    void Promise.resolve(finalTranscriptHandler(question)).catch((error) => {
      const message = error instanceof Error ? error.message : '语音问题作答失败'
      global.mainWindow?.webContents.send('solution-error', message)
    })
  }, QUESTION_SETTLE_MS)
}

function visibleText(): string {
  return [finalText, partialText].filter(Boolean).join(finalText && partialText ? '\n' : '')
}

function emitText(isPartial: boolean): void {
  accumulatedText = visibleText()
  global.mainWindow?.webContents.send('transcription-text', {
    text: accumulatedText,
    isPartial
  })
}

function emitStopped(): void {
  global.mainWindow?.webContents.send('transcription-stopped')
}

function cleanup(current: WebSocket | null): void {
  if (current && socket !== current) return
  socket = null
  ready = false
  stopping = false
  pendingAudio = []
  pendingAudioBytes = 0
}

export function getTranscriptionText(): string {
  return accumulatedText
}

export function clearTranscriptionText() {
  accumulatedText = ''
  finalText = ''
  partialText = ''
  cancelPendingQuestion()
}

ipcMain.handle('start-transcription', async (_event, practiceSessionId: string) => {
  if (socket) throw new Error('语音识别已经在运行')
  const { asrSession, streamTicket } = await offergetApi.startAsrTrial(practiceSessionId)
  const current = new WebSocket(offergetApi.asrStreamUrl(streamTicket), {
    perMessageDeflate: false
  })
  socket = current
  stopping = false
  pendingAudio = []
  pendingAudioBytes = 0

  return new Promise<{ expiresAt: string }>((resolve, reject) => {
    let settled = false
    let hadError = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      current.terminate()
      cleanup(current)
      reject(new Error('语音服务启动超时，请稍后重试'))
    }, 12_000)

    current.on('message', (raw) => {
      let message: {
        type?: string
        message?: string
        text?: string
        isPartial?: boolean
      }
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (message.type === 'ready') {
        ready = true
        for (const chunk of pendingAudio) current.send(chunk)
        pendingAudio = []
        pendingAudioBytes = 0
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve({ expiresAt: asrSession.expiresAt })
        }
        return
      }
      if (message.type === 'transcript' && typeof message.text === 'string') {
        if (message.isPartial) {
          partialText = message.text
          emitText(true)
        } else {
          finalText = [finalText, message.text].filter(Boolean).join('\n')
          partialText = ''
          emitText(false)
          queueFinalQuestion(message.text)
        }
        return
      }
      if (message.type === 'error') {
        hadError = true
        const errorMessage = message.message || '语音识别失败'
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new Error(errorMessage))
        } else {
          global.mainWindow?.webContents.send('transcription-error', errorMessage)
        }
        current.close()
        return
      }
      if (message.type === 'stopped') {
        stopping = true
        current.close()
      }
    })

    current.on('error', () => {
      hadError = true
      const message = '无法连接 offerGet 语音服务'
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(new Error(message))
      } else {
        global.mainWindow?.webContents.send('transcription-error', message)
      }
    })

    current.on('close', () => {
      clearTimeout(timeout)
      const wasReady = ready
      const wasStopping = stopping
      cleanup(current)
      if (!settled) {
        settled = true
        reject(new Error('语音服务连接已关闭'))
      } else if (wasReady && wasStopping) {
        emitStopped()
      } else if (wasReady && !hadError) {
        global.mainWindow?.webContents.send('transcription-error', '语音服务连接中断')
      }
    })
  })
})

export function stopTranscription(): void {
  const current = socket
  if (!current) {
    emitStopped()
    return
  }
  stopping = true
  if (current.readyState === WebSocket.OPEN) {
    current.send(JSON.stringify({ type: 'stop' }))
    setTimeout(() => {
      if (socket === current) current.close()
    }, 1_500)
  } else {
    current.close()
  }
}

ipcMain.handle('stop-transcription', () => stopTranscription())

ipcMain.on('transcription-audio-chunk', (_event, chunk: ArrayBuffer) => {
  const audio = Buffer.from(new Uint8Array(chunk))
  if (ready && socket?.readyState === WebSocket.OPEN) {
    socket.send(audio)
    return
  }
  if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED)
    return
  pendingAudio.push(audio)
  pendingAudioBytes += audio.byteLength
  while (pendingAudioBytes > MAX_PENDING_AUDIO_BYTES && pendingAudio.length > 1) {
    pendingAudioBytes -= pendingAudio.shift()!.byteLength
  }
})

ipcMain.handle('get-transcription-text', () => accumulatedText)
ipcMain.handle('clear-transcription-text', () => clearTranscriptionText())
