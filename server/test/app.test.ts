import test from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { buildApp } from '../src/app'
import type { AsrProvider } from '../src/asr'
import type { VisionProvider, VisionRequest } from '../src/vision'

const auth = (token: string) => ({ authorization: `Bearer ${token}` })
const mockAsrProvider: AsrProvider = {
  async connect(callbacks) {
    return {
      sendAudio() {
        callbacks.onTranscript('语音联调成功', false)
      },
      finish() {
        callbacks.onFinished()
      },
      close() {}
    }
  }
}
let lastVisionRequest: VisionRequest | undefined
const mockVisionProvider: VisionProvider = {
  async analyze(request) {
    lastVisionRequest = request
    return '视觉模型联调成功'
  }
}
async function login(app: ReturnType<typeof buildApp>, email = 'user@qq.com') {
  const sent = await app.inject({
    method: 'POST',
    url: '/v1/auth/send-email-code',
    payload: { email }
  })
  const code = (sent.json() as { devCode: string }).devCode
  const verified = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email-code',
    payload: { email, code }
  })
  return verified.json() as { accessToken: string }
}
test('QQ 登录限制和一次性验证码', async () => {
  const app = buildApp({ secret: 'test', devCodes: true })
  await app.ready()
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/send-email-code',
        payload: { email: 'a@gmail.com' }
      })
    ).statusCode,
    400
  )
  const session = await login(app)
  assert.ok(session.accessToken)
  await app.close()
})

test('生产模式通过邮件发送验证码且接口不返回明文', async () => {
  let delivered: { to: string; code: string } | undefined
  const app = buildApp({
    secret: 'test',
    devCodes: false,
    emailSender: {
      verify: async () => undefined,
      sendVerificationCode: async ({ to, code }) => {
        delivered = { to, code }
      }
    }
  })
  await app.ready()
  const sent = await app.inject({
    method: 'POST',
    url: '/v1/auth/send-email-code',
    payload: { email: 'mailtest@qq.com' }
  })
  assert.equal(sent.statusCode, 200)
  assert.equal(sent.json().devCode, undefined)
  assert.equal(delivered?.to, 'mailtest@qq.com')
  assert.match(delivered?.code ?? '', /^\d{6}$/)
  const verified = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email-code',
    payload: { email: 'mailtest@qq.com', code: delivered?.code }
  })
  assert.equal(verified.statusCode, 200)
  assert.ok(verified.json().accessToken)
  await app.close()
})
test('试用、语音次数与付款发卡闭环', async () => {
  const app = buildApp({
    secret: 'test',
    devCodes: true,
    asrProvider: mockAsrProvider,
    visionProvider: mockVisionProvider
  })
  await app.ready()
  const { accessToken } = await login(app)
  const started = await app.inject({
    method: 'POST',
    url: '/v1/practice-sessions/start',
    headers: auth(accessToken)
  })
  const ps = started.json().session
  assert.equal(ps.kind, 'trial')
  const asrKey = 'asr-start-1'
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/asr-trials/start',
        headers: { ...auth(accessToken), 'idempotency-key': asrKey },
        payload: { sessionId: ps.id }
      })
    ).statusCode,
    200
  )
  // Retry must not consume a second free voice entitlement.
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/asr-trials/start',
        headers: { ...auth(accessToken), 'idempotency-key': asrKey },
        payload: { sessionId: ps.id }
      })
    ).json().reused,
    true
  )
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/asr-trials/start',
          headers: auth(accessToken),
          payload: { sessionId: ps.id }
        })
      ).statusCode,
      200
    )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/asr-trials/start',
        headers: auth(accessToken),
        payload: { sessionId: ps.id }
      })
    ).statusCode,
    403
  )
  await app.inject({
    method: 'POST',
    url: `/v1/practice-sessions/${ps.id}/stop`,
    headers: auth(accessToken)
  })
  const orderResponse = await app.inject({
    method: 'POST',
    url: '/v1/checkout-sessions',
    headers: { ...auth(accessToken), 'idempotency-key': 'checkout-1' },
    payload: { productCode: 'ten_session' }
  })
  const order = orderResponse.json().order
  await app.inject({ method: 'POST', url: `/v1/dev/orders/${order.orderNo}/mark-paid` })
  await app.inject({ method: 'POST', url: `/v1/dev/orders/${order.orderNo}/mark-paid` })
  const entitlements = (
    await app.inject({ method: 'GET', url: '/v1/me/entitlements', headers: auth(accessToken) })
  ).json()
  assert.equal(entitlements.passes.available, 10)
  const paid = (
    await app.inject({
      method: 'POST',
      url: '/v1/practice-sessions/start',
      headers: auth(accessToken)
    })
  ).json().session
  assert.equal(paid.kind, 'paid')
  const beforePaidAsr = (
    await app.inject({ method: 'GET', url: '/v1/me/entitlements', headers: auth(accessToken) })
  ).json()
  assert.equal(beforePaidAsr.passes.available, 9)
  assert.equal(beforePaidAsr.activeSession.id, paid.id)
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/asr-trials/start',
        headers: { ...auth(accessToken), 'idempotency-key': 'paid-asr-start' },
        payload: { sessionId: paid.id }
      })
    ).statusCode,
    200
  )
  const afterPaidAsr = (
    await app.inject({ method: 'GET', url: '/v1/me/entitlements', headers: auth(accessToken) })
  ).json()
  assert.equal(afterPaidAsr.passes.available, 9)
  assert.equal(afterPaidAsr.activeSession.id, paid.id)
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/ai/screenshot',
        headers: auth(accessToken),
        payload: { sessionId: paid.id, requestId: 'r1', image: 'base64' }
      })
    ).statusCode,
    200
  )
  await app.close()
})

test('截图网关向模型转发图片和题目上下文并按请求去重', async () => {
  lastVisionRequest = undefined
  let calls = 0
  const visionProvider: VisionProvider = {
    async analyze(request) {
      calls += 1
      lastVisionRequest = request
      return '截图答案'
    }
  }
  const app = buildApp({ secret: 'test', devCodes: true, visionProvider })
  await app.ready()
  const { accessToken } = await login(app, 'vision@qq.com')
  const practice = (
    await app.inject({
      method: 'POST',
      url: '/v1/practice-sessions/start',
      headers: auth(accessToken)
    })
  ).json().session
  const payload = {
    sessionId: practice.id,
    requestId: 'vision-request-1',
    images: ['first-image', 'second-image'],
    prompt: '这是语音转录和题目说明',
    systemPrompt: '请用 TypeScript 回答'
  }
  const first = await app.inject({
    method: 'POST',
    url: '/v1/ai/screenshot',
    headers: auth(accessToken),
    payload
  })
  const repeated = await app.inject({
    method: 'POST',
    url: '/v1/ai/screenshot',
    headers: auth(accessToken),
    payload
  })
  assert.equal(first.statusCode, 200)
  assert.equal(first.json().answer, '截图答案')
  assert.equal(repeated.json().reused, true)
  assert.equal(calls, 1)
  assert.deepEqual(lastVisionRequest, {
    images: payload.images,
    prompt: payload.prompt,
    systemPrompt: payload.systemPrompt
  })
  await app.close()
})

test('截图模型未配置或供应商失败时返回稳定错误且不返回假答案', async () => {
  const app = buildApp({ secret: 'test', devCodes: true })
  await app.ready()
  const { accessToken } = await login(app, 'vision-off@qq.com')
  const practice = (
    await app.inject({
      method: 'POST',
      url: '/v1/practice-sessions/start',
      headers: auth(accessToken)
    })
  ).json().session
  const unavailable = await app.inject({
    method: 'POST',
    url: '/v1/ai/screenshot',
    headers: auth(accessToken),
    payload: {
      sessionId: practice.id,
      requestId: 'vision-off',
      image: 'base64'
    }
  })
  assert.equal(unavailable.statusCode, 503)
  assert.equal(unavailable.json().error.code, 'VISION_UNAVAILABLE')
  const entitlements = (
    await app.inject({
      method: 'GET',
      url: '/v1/me/entitlements',
      headers: auth(accessToken)
    })
  ).json()
  assert.equal(entitlements.features.screenshotRecognition, false)
  await app.close()

  const failedApp = buildApp({
    secret: 'test',
    devCodes: true,
    visionProvider: { analyze: async () => Promise.reject(new Error('provider secret detail')) }
  })
  await failedApp.ready()
  const failedLogin = await login(failedApp, 'vision-fail@qq.com')
  const failedPractice = (
    await failedApp.inject({
      method: 'POST',
      url: '/v1/practice-sessions/start',
      headers: auth(failedLogin.accessToken)
    })
  ).json().session
  const failed = await failedApp.inject({
    method: 'POST',
    url: '/v1/ai/screenshot',
    headers: auth(failedLogin.accessToken),
    payload: {
      sessionId: failedPractice.id,
      requestId: 'vision-fail',
      image: 'base64'
    }
  })
  assert.equal(failed.statusCode, 502)
  assert.equal(failed.json().error.code, 'VISION_PROVIDER_ERROR')
  assert.equal(failed.body.includes('provider secret detail'), false)
  await failedApp.close()
})

test('语音网关就绪后才扣免费次数并转发文本', async () => {
  const app = buildApp({ secret: 'test', devCodes: true, asrProvider: mockAsrProvider })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const { accessToken } = await login(app, 'voice@qq.com')
  const practice = (
    await app.inject({
      method: 'POST',
      url: '/v1/practice-sessions/start',
      headers: auth(accessToken)
    })
  ).json().session
  const started = await app.inject({
    method: 'POST',
    url: '/v1/asr-trials/start',
    headers: { ...auth(accessToken), 'idempotency-key': 'gateway-start' },
    payload: { sessionId: practice.id }
  })
  assert.equal(started.statusCode, 200)
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/v1/me/entitlements',
        headers: auth(accessToken)
      })
    ).json().trial.voice.remaining,
    3
  )

  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/v1/asr-stream?ticket=${started.json().streamTicket}`
  )
  const messages: { type: string; text?: string }[] = []
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('ASR gateway test timed out')), 2_000)
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      messages.push(message)
      if (message.type === 'ready') socket.send(Buffer.from([1, 2, 3]))
      if (message.type === 'transcript') {
        clearTimeout(timeout)
        resolve()
      }
    })
    socket.on('error', reject)
  })
  assert.equal(messages.some((message) => message.type === 'ready'), true)
  assert.equal(messages.find((message) => message.type === 'transcript')?.text, '语音联调成功')
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/v1/me/entitlements',
        headers: auth(accessToken)
      })
    ).json().trial.voice.remaining,
    2
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/asr-trials/start',
        headers: auth(accessToken),
        payload: { sessionId: practice.id }
      })
    ).statusCode,
    409
  )
  await app.inject({
    method: 'POST',
    url: `/v1/practice-sessions/${practice.id}/stop`,
    headers: auth(accessToken)
  })
  await new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) resolve()
    else socket.once('close', () => resolve())
  })
  assert.equal(messages.some((message) => message.type === 'stopped'), true)
  await app.close()
})

test('语音供应商未配置时禁用能力且不扣免费次数', async () => {
  const app = buildApp({ secret: 'test', devCodes: true })
  await app.ready()
  const { accessToken } = await login(app, 'voice-off@qq.com')
  const practice = (
    await app.inject({
      method: 'POST',
      url: '/v1/practice-sessions/start',
      headers: auth(accessToken)
    })
  ).json().session
  const started = await app.inject({
    method: 'POST',
    url: '/v1/asr-trials/start',
    headers: auth(accessToken),
    payload: { sessionId: practice.id }
  })
  assert.equal(started.statusCode, 503)
  const entitlements = (
    await app.inject({
      method: 'GET',
      url: '/v1/me/entitlements',
      headers: auth(accessToken)
    })
  ).json()
  assert.equal(entitlements.features.voiceRecognition, false)
  assert.equal(entitlements.trial.voice.remaining, 3)
  await app.close()
})

test('受保护资源拒绝未登录与伪造会话', async () => {
  const app = buildApp({ secret: 'test', devCodes: true })
  await app.ready()
  assert.equal((await app.inject({ method: 'GET', url: '/v1/me/entitlements' })).statusCode, 401)
  const { accessToken } = await login(app, 'another@qq.com')
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/ai/screenshot',
        headers: auth(accessToken),
        payload: { sessionId: 'forged', requestId: 'r1', image: 'base64' }
      })
    ).statusCode,
    403
  )
  await app.close()
})
