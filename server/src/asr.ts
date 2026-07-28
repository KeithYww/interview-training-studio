import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

export type AsrCallbacks = {
  onTranscript: (text: string, isPartial: boolean) => void
  onError: (message: string) => void
  onFinished: () => void
}

export type AsrConnection = {
  sendAudio: (chunk: Buffer) => void
  finish: () => void
  close: () => void
}

export type AsrProvider = {
  connect: (callbacks: AsrCallbacks) => Promise<AsrConnection>
}

type DashScopeEvent = {
  header?: {
    event?: string
    error_message?: string
  }
  payload?: {
    output?: {
      sentence?: {
        text?: string
        heartbeat?: boolean
        sentence_end?: boolean
      }
    }
  }
}

export function createDashScopeAsrProviderFromEnv(): AsrProvider | undefined {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) return undefined
  const endpoint =
    process.env.DASHSCOPE_ASR_WS_URL?.trim() ||
    'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
  const model = process.env.DASHSCOPE_ASR_MODEL?.trim() || 'fun-asr-realtime'

  return {
    connect(callbacks) {
      return new Promise<AsrConnection>((resolve, reject) => {
        const taskId = randomUUID()
        const socket = new WebSocket(endpoint, {
          headers: { Authorization: `Bearer ${apiKey}` },
          perMessageDeflate: false
        })
        let started = false
        let settled = false
        let closing = false
        let terminalNotified = false
        let finishSent = false
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true
            socket.terminate()
            reject(new Error('语音服务连接超时'))
          }
        }, 10_000)

        const connection: AsrConnection = {
          sendAudio(chunk) {
            if (started && socket.readyState === WebSocket.OPEN) socket.send(chunk)
          },
          finish() {
            if (finishSent || socket.readyState !== WebSocket.OPEN) return
            finishSent = true
            socket.send(
              JSON.stringify({
                header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
                payload: { input: {} }
              })
            )
          },
          close() {
            closing = true
            if (
              socket.readyState === WebSocket.OPEN ||
              socket.readyState === WebSocket.CONNECTING
            )
              socket.close()
          }
        }

        socket.on('open', () => {
          socket.send(
            JSON.stringify({
              header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
              payload: {
                task_group: 'audio',
                task: 'asr',
                function: 'recognition',
                model,
                parameters: {
                  format: 'pcm',
                  sample_rate: 16000,
                  max_sentence_silence: 600
                },
                input: {}
              }
            })
          )
        })

        socket.on('message', (raw) => {
          if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) return
          let event: DashScopeEvent
          try {
            event = JSON.parse(raw.toString()) as DashScopeEvent
          } catch {
            return
          }
          const eventName = event.header?.event
          if (eventName === 'task-started') {
            started = true
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              resolve(connection)
            }
            return
          }
          if (eventName === 'result-generated') {
            const sentence = event.payload?.output?.sentence
            if (sentence?.heartbeat || !sentence?.text) return
            callbacks.onTranscript(sentence.text, !sentence.sentence_end)
            return
          }
          if (eventName === 'task-finished') {
            if (!terminalNotified) {
              terminalNotified = true
              callbacks.onFinished()
            }
            socket.close()
            return
          }
          if (eventName === 'task-failed') {
            const message = event.header?.error_message || '语音识别任务失败'
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              reject(new Error(message))
            } else {
              terminalNotified = true
              callbacks.onError(message)
            }
            socket.close()
          }
        })

        socket.on('error', (error) => {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            reject(error)
          } else if (!terminalNotified && !closing) {
            terminalNotified = true
            callbacks.onError('语音服务连接异常')
          }
        })

        socket.on('close', () => {
          clearTimeout(timeout)
          if (!settled) {
            settled = true
            reject(new Error('语音服务连接已关闭'))
          } else if (started && !terminalNotified && !closing) {
            terminalNotified = true
            callbacks.onError('语音服务连接中断')
          }
        })
      })
    }
  }
}
