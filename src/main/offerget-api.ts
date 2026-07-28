import { app, ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const defaultBaseUrl = app.isPackaged ? 'https://43.142.15.246:8443/api' : 'http://127.0.0.1:3001'
const baseUrl = (process.env.OFFERGET_API_URL || defaultBaseUrl).replace(/\/$/, '')

type Tokens = { accessToken: string; refreshToken: string }
let tokens: Tokens | null = null
let tokensHydrated = false
let refreshPromise: Promise<void> | null = null

const tokenFilePath = () => join(app.getPath('userData'), 'offerget-auth.bin')

async function hydrateTokens() {
  if (tokensHydrated) return
  tokensHydrated = true
  if (!safeStorage.isEncryptionAvailable()) return
  try {
    const encrypted = await readFile(tokenFilePath())
    const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as Tokens
    if (parsed.accessToken && parsed.refreshToken) tokens = parsed
  } catch {
    tokens = null
  }
}

async function saveTokens(next: Tokens | null) {
  tokens = next
  tokensHydrated = true
  if (!safeStorage.isEncryptionAvailable()) return
  if (!next) {
    await unlink(tokenFilePath()).catch(() => undefined)
    return
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(next))
  await writeFile(tokenFilePath(), encrypted, { mode: 0o600 })
}

async function refreshAuthTokens(): Promise<void> {
  if (refreshPromise) return refreshPromise
  if (!tokens?.refreshToken) throw new OfferGetError('登录状态已失效，请重新登录', 'AUTH_REQUIRED')
  const refreshToken = tokens.refreshToken
  refreshPromise = request<Tokens>('/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken })
  })
    .then((refreshed) => saveTokens(refreshed))
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

export type PracticeSession = {
  id: string
  expiresAt: string
  voiceExpiresAt?: string
  kind?: 'trial' | 'paid' | 'activation'
}
export type AsrSession = {
  id: string
  practiceSessionId: string
  userId: string
  expiresAt: string
  billed: boolean
}
export type Entitlements = {
  user?: { id: string; email: string }
  trial?: {
    screenshot?: { used: boolean; durationMinutes: number }
    voice?: { remaining: number; durationMinutes: number }
  }
  passes?: { available: number; paid?: number; activation?: number }
  activeSession?: PracticeSession | null
  features?: { voiceRecognition: boolean; screenshotRecognition: boolean }
  serverTime?: string
}

class OfferGetError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message)
  }
}

async function fetchResponse(
  path: string,
  init: RequestInit = {},
  authenticated = false
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  if (authenticated) {
    await hydrateTokens()
    if (!tokens?.accessToken)
      throw new OfferGetError('请先登录后再使用完整练习功能', 'AUTH_REQUIRED')
    headers.set('authorization', `Bearer ${tokens.accessToken}`)
  }
  try {
    return await fetch(`${baseUrl}${path}`, { ...init, headers })
  } catch {
    throw new OfferGetError('无法连接 offerGet 服务，请确认后端已启动', 'SERVICE_UNAVAILABLE')
  }
}

async function responseError(response: Response): Promise<OfferGetError> {
  const body = await response.json().catch(() => ({}))
  return new OfferGetError(
    body.error?.message || body.message || '服务暂时不可用，请稍后重试',
    body.error?.code || body.code
  )
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
  const response = await fetchResponse(path, init, authenticated)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new OfferGetError(
      body.error?.message || body.message || '服务暂时不可用，请稍后重试',
      body.error?.code || body.code
    )
  }
  return body as T
}

async function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await request<T>(path, init, true)
  } catch (error) {
    if (
      !(error instanceof OfferGetError) ||
      error.code !== 'AUTH_REQUIRED' ||
      !tokens?.refreshToken
    )
      throw error
    await refreshAuthTokens()
    return request<T>(path, init, true)
  }
}

async function authenticatedResponse(path: string, init: RequestInit = {}): Promise<Response> {
  let response = await fetchResponse(path, init, true)
  if (response.status === 401 && tokens?.refreshToken) {
    const error = await responseError(response.clone())
    if (error.code === 'AUTH_REQUIRED') {
      await refreshAuthTokens()
      response = await fetchResponse(path, init, true)
    }
  }
  if (!response.ok) throw await responseError(response)
  return response
}

type ScreenshotStreamEvent =
  | { type: 'delta'; text?: string }
  | { type: 'done' }
  | { type: 'error'; code?: string; message?: string }

export const offergetApi = {
  async sendCode(email: string) {
    return request<{ devCode?: string }>('/v1/auth/send-email-code', {
      method: 'POST',
      body: JSON.stringify({ email })
    })
  },
  async verifyCode(email: string, code: string) {
    const result = await request<Tokens & { user: { id: string; email: string } }>(
      '/v1/auth/verify-email-code',
      { method: 'POST', body: JSON.stringify({ email, code }) }
    )
    await saveTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken })
    return { user: result.user }
  },
  logout: () => saveTokens(null),
  entitlements: () => authenticatedRequest<Entitlements>('/v1/me/entitlements'),
  async activeSession() {
    const entitlements = await this.entitlements()
    if (!entitlements.activeSession?.id)
      throw new OfferGetError('请先启动练习会话', 'NO_ACTIVE_SESSION')
    if (new Date(entitlements.activeSession.expiresAt).getTime() <= Date.now()) {
      throw new OfferGetError('本次练习已到期，请重新启动会话', 'SESSION_EXPIRED')
    }
    return entitlements.activeSession
  },
  startSession: () =>
    authenticatedRequest<{ session: PracticeSession }>('/v1/practice-sessions/start', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: '{}'
    }),
  stopSession: (id: string) =>
    authenticatedRequest(`/v1/practice-sessions/${id}/stop`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: '{}'
    }),
  startAsrTrial: (sessionId: string) =>
    authenticatedRequest<{ asrSession: AsrSession; streamTicket: string }>('/v1/asr-trials/start', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ sessionId })
    }),
  asrStreamUrl: (ticket: string) => {
    const url = new URL(`${baseUrl}/`)
    url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/asr-stream`
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('ticket', ticket)
    return url.toString()
  },
  checkout: (productCode: 'single_session' | 'ten_session') =>
    authenticatedRequest<{ order: { orderNo: string }; payment?: unknown }>(
      '/v1/checkout-sessions',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ productCode })
      }
    ),
  order: (orderNo: string) => authenticatedRequest(`/v1/orders/${orderNo}`),
  redeemActivationCode: (code: string) =>
    authenticatedRequest<{
      redeemed: boolean
      benefit: { interviews: number; screenshotMinutes: number; voiceMinutes: number }
      entitlements: Entitlements
    }>('/v1/activation-codes/redeem', {
      method: 'POST',
      body: JSON.stringify({ code })
    }),
  markPaid: (orderNo: string) =>
    authenticatedRequest(`/v1/dev/orders/${orderNo}/mark-paid`, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: '{}'
    }),
  async *screenshotStream(
    sessionId: string,
    images: string[],
    prompt: string,
    systemPrompt?: string,
    requestId = randomUUID(),
    signal?: AbortSignal
  ): AsyncIterable<string> {
    const response = await authenticatedResponse('/v1/ai/screenshot', {
      method: 'POST',
      headers: { accept: 'application/x-ndjson' },
      body: JSON.stringify({ sessionId, requestId, images, prompt, systemPrompt }),
      signal
    })
    if (!response.body) throw new OfferGetError('服务未返回生成数据', 'EMPTY_RESPONSE')

    const decoder = new TextDecoder()
    let buffer = ''
    let receivedText = false
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let event: ScreenshotStreamEvent
        try {
          event = JSON.parse(line) as ScreenshotStreamEvent
        } catch {
          continue
        }
        if (event.type === 'error') {
          throw new OfferGetError(event.message || '截图识别暂时失败', event.code)
        }
        if (event.type === 'delta' && event.text) {
          receivedText = true
          yield event.text
        }
      }
    }
    if (!receivedText) throw new OfferGetError('模型没有返回有效答案', 'EMPTY_RESPONSE')
  },
  async *answerStream(
    sessionId: string,
    prompt: string,
    systemPrompt?: string,
    requestId = randomUUID(),
    signal?: AbortSignal
  ): AsyncIterable<string> {
    const response = await authenticatedResponse('/v1/ai/answer', {
      method: 'POST',
      headers: { accept: 'application/x-ndjson' },
      body: JSON.stringify({ sessionId, requestId, prompt, systemPrompt }),
      signal
    })
    if (!response.body) throw new OfferGetError('服务未返回生成数据', 'EMPTY_RESPONSE')

    const decoder = new TextDecoder()
    let buffer = ''
    let receivedText = false
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let event: ScreenshotStreamEvent
        try {
          event = JSON.parse(line) as ScreenshotStreamEvent
        } catch {
          continue
        }
        if (event.type === 'error') {
          throw new OfferGetError(event.message || '模型回答暂时失败', event.code)
        }
        if (event.type === 'delta' && event.text) {
          receivedText = true
          yield event.text
        }
      }
    }
    if (!receivedText) throw new OfferGetError('模型没有返回有效答案', 'EMPTY_RESPONSE')
  }
}

function serializeError(error: unknown) {
  if (error instanceof OfferGetError) return { message: error.message, code: error.code }
  return { message: error instanceof Error ? error.message : '服务连接失败' }
}

ipcMain.handle('offerget:send-code', async (_event, email: string) => {
  try {
    return { ok: true, ...(await offergetApi.sendCode(email)) }
  } catch (error) {
    return { ok: false, ...serializeError(error) }
  }
})
ipcMain.handle('offerget:verify-code', async (_event, email: string, code: string) => {
  try {
    return { ok: true, ...(await offergetApi.verifyCode(email, code)) }
  } catch (error) {
    return { ok: false, ...serializeError(error) }
  }
})
ipcMain.handle('offerget:logout', () => offergetApi.logout())
ipcMain.handle('offerget:entitlements', async () => {
  try {
    return { ok: true, data: await offergetApi.entitlements() }
  } catch (error) {
    return { ok: false, ...serializeError(error) }
  }
})
ipcMain.handle('offerget:start-session', async () => {
  try {
    return { ok: true, ...(await offergetApi.startSession()) }
  } catch (error) {
    return { ok: false, ...serializeError(error) }
  }
})
ipcMain.handle('offerget:stop-session', async (_event, id: string) => {
  try {
    return { ok: true, await: await offergetApi.stopSession(id) }
  } catch (error) {
    return { ok: false, ...serializeError(error) }
  }
})
ipcMain.handle('offerget:start-asr', async (_event, sessionId: string) => {
  try {
    return { ok: true, data: await offergetApi.startAsrTrial(sessionId) }
  } catch (error) {
    return { ok: false, ...serializeError(error) }
  }
})
ipcMain.handle(
  'offerget:checkout',
  async (_event, productCode: 'single_session' | 'ten_session') => {
    try {
      return { ok: true, ...(await offergetApi.checkout(productCode)) }
    } catch (error) {
      return { ok: false, ...serializeError(error) }
    }
  }
)
ipcMain.handle('offerget:order', async (_event, orderNo: string) => {
  try {
    return { ok: true, data: await offergetApi.order(orderNo) }
  } catch (error) {
    return { ok: false, ...serializeError(error) }
  }
})
ipcMain.handle('offerget:redeem-activation-code', async (_event, code: string) => {
  try {
    return { ok: true, ...(await offergetApi.redeemActivationCode(code)) }
  } catch (error) {
    return { ok: false, ...serializeError(error) }
  }
})
ipcMain.handle('offerget:mark-paid', async (_event, orderNo: string) => {
  try {
    return { ok: true, data: await offergetApi.markPaid(orderNo) }
  } catch (error) {
    return { ok: false, ...serializeError(error) }
  }
})
