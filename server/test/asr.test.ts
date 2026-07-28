import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createDashScopeAsrProviderFromEnv } from '../src/asr'

test('Fun-ASR 结束事件只发送一次，异常断开不会伪装成正常结束', async () => {
  const previous = {
    key: process.env.DASHSCOPE_API_KEY,
    endpoint: process.env.DASHSCOPE_ASR_WS_URL
  }
  const server = createServer()
  const webSocketServer = new WebSocketServer({ server })
  let connectionCount = 0
  let finishMessages = 0
  webSocketServer.on('connection', (socket) => {
    connectionCount += 1
    const currentConnection = connectionCount
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as {
        header?: { action?: string; task_id?: string }
      }
      if (message.header?.action === 'run-task') {
        socket.send(
          JSON.stringify({
            header: { event: 'task-started', task_id: message.header.task_id }
          })
        )
        if (currentConnection === 2) setTimeout(() => socket.close(), 10)
      }
      if (message.header?.action === 'finish-task') {
        finishMessages += 1
        socket.send(
          JSON.stringify({
            header: { event: 'task-finished', task_id: message.header.task_id }
          })
        )
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  try {
    process.env.DASHSCOPE_API_KEY = 'server-only-test-key'
    process.env.DASHSCOPE_ASR_WS_URL = `ws://127.0.0.1:${address.port}`
    const provider = createDashScopeAsrProviderFromEnv()
    assert.ok(provider)

    let finished = 0
    const errors: string[] = []
    const firstFinished = new Promise<void>((resolve) => {
      void provider
        .connect({
          onTranscript: () => undefined,
          onError: (message) => errors.push(message),
          onFinished: () => {
            finished += 1
            resolve()
          }
        })
        .then((connection) => {
          connection.finish()
          connection.finish()
        })
    })
    await firstFinished
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(finishMessages, 1)
    assert.equal(finished, 1)
    assert.deepEqual(errors, [])

    const disconnected = new Promise<string>((resolve) => {
      void provider.connect({
        onTranscript: () => undefined,
        onError: resolve,
        onFinished: () => {
          finished += 1
        }
      })
    })
    assert.equal(await disconnected, '语音服务连接中断')
    assert.equal(finished, 1)
  } finally {
    for (const client of webSocketServer.clients) client.terminate()
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()))
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    if (previous.key === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = previous.key
    if (previous.endpoint === undefined) delete process.env.DASHSCOPE_ASR_WS_URL
    else process.env.DASHSCOPE_ASR_WS_URL = previous.endpoint
  }
})

test('Fun-ASR 任务结束时会把最后一条 partial 提升为最终转写', async () => {
  const previous = {
    key: process.env.DASHSCOPE_API_KEY,
    endpoint: process.env.DASHSCOPE_ASR_WS_URL
  }
  const server = createServer()
  const webSocketServer = new WebSocketServer({ server })
  webSocketServer.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as {
        header?: { action?: string; task_id?: string }
      }
      if (message.header?.action === 'run-task') {
        socket.send(
          JSON.stringify({
            header: { event: 'task-started', task_id: message.header.task_id }
          })
        )
        socket.send(
          JSON.stringify({
            header: { event: 'result-generated', task_id: message.header.task_id },
            payload: {
              output: {
                sentence: {
                  text: '请介绍一下 JavaScript 的事件循环',
                  sentence_end: false
                }
              }
            }
          })
        )
      }
      if (message.header?.action === 'finish-task') {
        socket.send(
          JSON.stringify({
            header: { event: 'task-finished', task_id: message.header.task_id }
          })
        )
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  try {
    process.env.DASHSCOPE_API_KEY = 'server-only-test-key'
    process.env.DASHSCOPE_ASR_WS_URL = `ws://127.0.0.1:${address.port}`
    const provider = createDashScopeAsrProviderFromEnv()
    assert.ok(provider)

    const transcripts: Array<{ text: string; isPartial: boolean }> = []
    await new Promise<void>((resolve) => {
      void provider
        .connect({
          onTranscript: (text, isPartial) => transcripts.push({ text, isPartial }),
          onError: (message) => assert.fail(message),
          onFinished: resolve
        })
        .then((connection) => connection.finish())
    })

    assert.deepEqual(transcripts, [
      { text: '请介绍一下 JavaScript 的事件循环', isPartial: true },
      { text: '请介绍一下 JavaScript 的事件循环', isPartial: false }
    ])
  } finally {
    for (const client of webSocketServer.clients) client.terminate()
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()))
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    if (previous.key === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = previous.key
    if (previous.endpoint === undefined) delete process.env.DASHSCOPE_ASR_WS_URL
    else process.env.DASHSCOPE_ASR_WS_URL = previous.endpoint
  }
})
