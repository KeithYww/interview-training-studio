import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import Fastify, { FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import WebSocket, { WebSocketServer } from 'ws'
import type { EmailSender } from './email'
import type { AsrConnection, AsrProvider } from './asr'
import type { VisionConversationMessage, VisionProvider } from './vision'

type ProductCode = 'single_session' | 'ten_session'
export type User = { id: string; email: string; createdAt: string }
export type Session = {
  id: string
  userId: string
  kind: 'trial' | 'paid' | 'activation'
  startedAt: string
  expiresAt: string
  voiceExpiresAt?: string
  stoppedAt?: string
}
export type Order = {
  orderNo: string
  userId: string
  productCode: ProductCode
  amountFen: number
  status: 'pending' | 'paid'
  passesGranted: number
  expiresAt: string
  fulfilledAt?: string
}
type EmailCode = { hash: string; expiresAt: number; attempts: number; lastSentAt: number }
export type PassBalance = {
  count: number
  expiresAt: number
  kind?: 'paid' | 'activation' | 'manual'
}
export type ActivationCode = {
  createdAt: string
  expiresAt: string
  batchId?: string
  label?: string
  codeHint?: string
  redeemedAt?: string
  redeemedBy?: string
  revokedAt?: string
  revokedReason?: string
}
export type AdminAuditEvent = {
  id: string
  action: string
  createdAt: string
  target?: string
  detail?: Record<string, string | number | boolean | undefined>
}
type AsrSession = {
  id: string
  practiceSessionId: string
  userId: string
  expiresAt: string
  billed: boolean
}
type AsrTicket = {
  ticket: string
  asrSession: AsrSession
  expiresAt: number
  consumed: boolean
}

const PRODUCTS: Record<ProductCode, { amountFen: number; passes: number; passDays: number }> = {
  single_session: { amountFen: 990, passes: 1, passDays: 30 },
  ten_session: { amountFen: 8800, passes: 10, passDays: 90 }
}
const now = () => Date.now()
const iso = (ms = now()) => new Date(ms).toISOString()
const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`
const validEmail = (email: unknown): email is string =>
  typeof email === 'string' && /^[^\s@]+@qq\.com$/i.test(email.trim())
const normalizeEmail = (email: string) => email.trim().toLowerCase()
const normalizeActivationCode = (code: string) => code.trim().toUpperCase()
const ACTIVATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function activationCode() {
  const bytes = randomBytes(16)
  let value = ''
  for (let index = 0; index < 16; index += 1) {
    value += ACTIVATION_ALPHABET[bytes[index] % ACTIVATION_ALPHABET.length]
  }
  return `OGET-${value.match(/.{1,4}/g)!.join('-')}`
}

export class MemoryRepository {
  usersByEmail = new Map<string, User>()
  users = new Map<string, User>()
  codes = new Map<string, EmailCode>()
  refreshTokens = new Map<string, string>()
  trialUsed = new Set<string>()
  voiceUses = new Map<string, number>()
  passes = new Map<string, PassBalance[]>()
  activationCodes = new Map<string, ActivationCode>()
  adminAuditEvents: AdminAuditEvent[] = []
  sessions = new Map<string, Session>()
  orders = new Map<string, Order>()
  checkoutKeys = new Map<string, string>()
  asrStartKeys = new Map<string, AsrTicket>()
  asrTickets = new Map<string, AsrTicket>()
  asrConnecting = new Set<string>()
  activeAsrSessions = new Map<string, AsrSession>()
  asrClosers = new Map<string, () => void>()
  paidEvents = new Set<string>()
  screenshotRequests = new Map<string, string>()

  async persist(): Promise<void> {
    return undefined
  }

  async health() {
    return { database: false, persistent: false }
  }

  async close(): Promise<void> {
    return undefined
  }
}

function error(
  reply: { code: (n: number) => unknown },
  status: number,
  code: string,
  message: string
) {
  return (reply.code(status) as { send: (body: unknown) => unknown }).send({
    error: { code, message }
  })
}

export function buildApp(
  options: {
    secret?: string
    devCodes?: boolean
    repository?: MemoryRepository
    emailSender?: EmailSender
    asrProvider?: AsrProvider
    visionProvider?: VisionProvider
    adminSecret?: string
    adminPassword?: string
  } = {}
) {
  const secret = options.secret ?? process.env.APP_SECRET ?? 'local-development-secret'
  const adminSecret =
    options.adminSecret?.trim() ||
    process.env.ACTIVATION_ADMIN_SECRET?.trim() ||
    process.env.APP_SECRET?.trim() ||
    secret
  const devCodes = options.devCodes ?? process.env.DEV_EMAIL_CODES !== 'false'
  const adminPassword =
    options.adminPassword?.trim() ||
    process.env.ADMIN_CONSOLE_PASSWORD?.trim() ||
    process.env.ACTIVATION_ADMIN_SECRET?.trim()
  const repo = options.repository ?? new MemoryRepository()
  const emailSender = options.emailSender
  const asrProvider = options.asrProvider
  const visionProvider = options.visionProvider
  const app = Fastify({
    logger: process.env.NODE_ENV === 'production' ? { level: 'info' } : false
  })
  void app.register(cors, { origin: process.env.CORS_ORIGIN ?? true })

  const hash = (value: string) => createHmac('sha256', secret).update(value).digest('hex')
  const sign = (payload: Record<string, unknown>) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
  }
  const verify = (token: string): Record<string, unknown> | undefined => {
    const [body, signature] = token.split('.')
    if (!body || !signature) return undefined
    const expected = createHmac('sha256', secret).update(body).digest('base64url')
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      return undefined
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>
      return typeof payload.exp === 'number' && payload.exp > now() ? payload : undefined
    } catch {
      return undefined
    }
  }
  const tokenPair = (user: User) => {
    const accessToken = sign({ sub: user.id, exp: now() + 15 * 60_000 })
    const refreshToken = id('rt')
    repo.refreshTokens.set(hash(refreshToken), user.id)
    return { accessToken, refreshToken, user }
  }
  const getUser = (request: FastifyRequest) => {
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    const payload = token && verify(token)
    return payload && typeof payload.sub === 'string' ? repo.users.get(payload.sub) : undefined
  }
  const requireUser = (
    request: FastifyRequest,
    reply: Parameters<typeof error>[0]
  ): User | undefined => {
    const user = getUser(request)
    if (!user) error(reply, 401, 'AUTH_REQUIRED', '请先登录')
    return user
  }
  const requireAdmin = (request: FastifyRequest, reply: Parameters<typeof error>[0]): boolean => {
    const supplied = request.headers['x-activation-admin-secret']
    if (
      typeof supplied !== 'string' ||
      supplied.length !== adminSecret.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(adminSecret))
    ) {
      error(reply, 404, 'NOT_FOUND', '资源不存在')
      return false
    }
    return true
  }
  const getAdmin = (request: FastifyRequest) => {
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    const payload = token ? verify(token) : undefined
    return payload?.role === 'admin' ? payload : undefined
  }
  const requireAdminSession = (
    request: FastifyRequest,
    reply: Parameters<typeof error>[0]
  ): boolean => {
    if (getAdmin(request)) return true
    error(reply, 401, 'ADMIN_AUTH_REQUIRED', '请先登录后台管理')
    return false
  }
  const addAudit = (
    action: string,
    target?: string,
    detail?: AdminAuditEvent['detail']
  ) => {
    repo.adminAuditEvents.unshift({ id: id('audit'), action, target, detail, createdAt: iso() })
    repo.adminAuditEvents.splice(500, Number.MAX_SAFE_INTEGER)
  }
  const redemptionAttempts = new Map<string, number[]>()
  const activeSession = (userId: string) =>
    [...repo.sessions.values()].find(
      (s) => s.userId === userId && !s.stoppedAt && Date.parse(s.expiresAt) > now()
    )
  const activePasses = (userId: string) =>
    (repo.passes.get(userId) ?? []).filter((p) => p.expiresAt > now() && p.count > 0)
  const passCount = (userId: string, kind: 'paid' | 'activation') =>
    activePasses(userId)
      .filter((pass) =>
        kind === 'paid' ? (pass.kind ?? 'paid') !== 'activation' : pass.kind === 'activation'
      )
      .reduce((sum, pass) => sum + pass.count, 0)
  const entitlement = (user: User) => ({
    user,
    trial: {
      screenshot: { used: repo.trialUsed.has(user.id), durationMinutes: 45 },
      voice: { remaining: Math.max(0, 3 - (repo.voiceUses.get(user.id) ?? 0)), durationMinutes: 15 }
    },
    passes: {
      available: activePasses(user.id).reduce((sum, pass) => sum + pass.count, 0),
      paid: passCount(user.id, 'paid'),
      activation: passCount(user.id, 'activation')
    },
    screenshotTrial: { used: repo.trialUsed.has(user.id), durationMinutes: 45 },
    voiceTrial: {
      remaining: Math.max(0, 3 - (repo.voiceUses.get(user.id) ?? 0)),
      durationMinutes: 15
    },
    sessionPasses: activePasses(user.id).reduce((sum, pass) => sum + pass.count, 0),
    activeSession: activeSession(user.id) ?? null,
    features: {
      voiceRecognition: Boolean(asrProvider),
      screenshotRecognition: Boolean(visionProvider)
    },
    serverTime: iso()
  })

  const pendingVoiceReservations = (userId: string) =>
    [...repo.asrTickets.values()].filter(
      (ticket) =>
        ticket.asrSession.userId === userId &&
        !ticket.consumed &&
        ticket.expiresAt > now() &&
        !ticket.asrSession.billed
    ).length

  const asrWebSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false
  })
  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname !== '/v1/asr-stream') return
    asrWebSocketServer.handleUpgrade(request, socket, head, (client) => {
      asrWebSocketServer.emit('connection', client, request)
    })
  })

  asrWebSocketServer.on('connection', (client, request) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const ticketId = url.searchParams.get('ticket')
    const ticket = ticketId ? repo.asrTickets.get(ticketId) : undefined
    if (!ticket || ticket.consumed || ticket.expiresAt <= now() || !asrProvider) {
      client.send(
        JSON.stringify({
          type: 'error',
          message: !asrProvider ? '服务器尚未配置语音识别服务' : '语音连接凭证无效或已过期'
        })
      )
      client.close()
      return
    }

    ticket.consumed = true
    repo.asrConnecting.add(ticket.asrSession.practiceSessionId)
    let upstream: AsrConnection | null = null
    let expiryTimer: NodeJS.Timeout | null = null
    let closed = false
    const closeAll = () => {
      if (closed) return
      closed = true
      if (expiryTimer) clearTimeout(expiryTimer)
      upstream?.close()
      repo.asrConnecting.delete(ticket.asrSession.practiceSessionId)
      if (
        repo.activeAsrSessions.get(ticket.asrSession.practiceSessionId)?.id === ticket.asrSession.id
      )
        repo.activeAsrSessions.delete(ticket.asrSession.practiceSessionId)
      repo.asrClosers.delete(ticket.asrSession.practiceSessionId)
      if (client.readyState === WebSocket.OPEN) client.close()
    }
    const send = (message: unknown) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message))
    }
    repo.asrClosers.set(ticket.asrSession.practiceSessionId, () => {
      upstream?.finish()
      send({ type: 'stopped', reason: 'interview-ended' })
      closeAll()
    })

    void asrProvider
      .connect({
        onTranscript: (text, isPartial) => send({ type: 'transcript', text, isPartial }),
        onError: (message) => {
          send({ type: 'error', message })
          closeAll()
        },
        onFinished: () => {
          send({ type: 'stopped' })
          closeAll()
        }
      })
      .then(async (connection) => {
        if (closed) {
          connection.close()
          repo.asrTickets.delete(ticket.ticket)
          return
        }
        const practice = repo.sessions.get(ticket.asrSession.practiceSessionId)
        if (!practice || practice.stoppedAt || Date.parse(practice.expiresAt) <= now()) {
          connection.close()
          send({ type: 'error', message: '面试已结束，语音识别已停止' })
          closeAll()
          return
        }
        if (practice.kind === 'trial') {
          const used = repo.voiceUses.get(ticket.asrSession.userId) ?? 0
          if (used >= 3) {
            connection.close()
            send({ type: 'error', message: '免费语音次数已用完' })
            closeAll()
            return
          }
          repo.voiceUses.set(ticket.asrSession.userId, used + 1)
          ticket.asrSession.billed = true
        }
        upstream = connection
        repo.asrConnecting.delete(ticket.asrSession.practiceSessionId)
        repo.activeAsrSessions.set(ticket.asrSession.practiceSessionId, ticket.asrSession)
        repo.asrTickets.delete(ticket.ticket)
        await repo.persist()
        const expiresIn = Math.max(0, Date.parse(ticket.asrSession.expiresAt) - now())
        expiryTimer = setTimeout(() => {
          upstream?.finish()
          send({ type: 'stopped', reason: 'expired' })
          closeAll()
        }, expiresIn)
        send({ type: 'ready', asrSession: ticket.asrSession })
      })
      .catch((connectionError) => {
        repo.asrTickets.delete(ticket.ticket)
        send({
          type: 'error',
          message:
            connectionError instanceof Error ? connectionError.message : '语音识别服务连接失败'
        })
        closeAll()
      })

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        upstream?.sendAudio(Buffer.from(data as Buffer))
        return
      }
      try {
        const message = JSON.parse(data.toString()) as { type?: string }
        if (message.type === 'stop') upstream?.finish()
      } catch {
        send({ type: 'error', message: '无法识别的语音控制消息' })
      }
    })
    client.on('close', closeAll)
    client.on('error', closeAll)
  })

  app.addHook('onClose', async () => {
    for (const client of asrWebSocketServer.clients) client.terminate()
    asrWebSocketServer.close()
    await repo.close()
  })

  app.get('/health', async (_request, reply) => {
    try {
      const persistence = await repo.health()
      return {
        status: 'ok',
        version: process.env.APP_VERSION || 'development',
        dependencies: {
          database: persistence.database,
          smtp: Boolean(emailSender),
          voice: Boolean(asrProvider),
          vision: Boolean(visionProvider)
        },
        persistent: persistence.persistent
      }
    } catch {
      return error(reply, 503, 'DATABASE_UNAVAILABLE', '数据库连接不可用')
    }
  })

  app.post('/v1/auth/send-email-code', async (request, reply) => {
    const { email } = (request.body ?? {}) as { email?: unknown }
    if (!validEmail(email)) return error(reply, 400, 'INVALID_EMAIL', '仅支持 QQ 邮箱')
    const normalized = normalizeEmail(email)
    const old = repo.codes.get(normalized)
    if (old && now() - old.lastSentAt < 60_000)
      return error(reply, 429, 'RATE_LIMITED', '请 60 秒后再试')
    const code = String(Math.floor(100000 + Math.random() * 900000))
    if (!emailSender && !devCodes)
      return error(reply, 503, 'EMAIL_UNAVAILABLE', '邮件服务暂不可用，请稍后重试')
    if (emailSender) {
      try {
        await emailSender.sendVerificationCode({
          to: normalized,
          code,
          expiresInMinutes: 5
        })
      } catch (sendError) {
        request.log.error(sendError)
        return error(reply, 502, 'EMAIL_SEND_FAILED', '验证码邮件发送失败，请稍后重试')
      }
    }
    repo.codes.set(normalized, {
      hash: hash(code),
      expiresAt: now() + 5 * 60_000,
      attempts: 0,
      lastSentAt: now()
    })
    return { sent: true, ...(devCodes ? { devCode: code } : {}) }
  })
  app.post('/v1/auth/verify-email-code', async (request, reply) => {
    const { email, code } = (request.body ?? {}) as { email?: unknown; code?: unknown }
    if (!validEmail(email)) return error(reply, 400, 'INVALID_EMAIL', '仅支持 QQ 邮箱')
    const saved = repo.codes.get(normalizeEmail(email))
    if (!saved || saved.expiresAt <= now()) return error(reply, 400, 'CODE_EXPIRED', '验证码已过期')
    saved.attempts += 1
    if (saved.attempts > 5 || typeof code !== 'string' || saved.hash !== hash(code))
      return error(reply, 400, 'CODE_EXPIRED', '验证码无效')
    repo.codes.delete(normalizeEmail(email))
    let user = repo.usersByEmail.get(normalizeEmail(email))
    if (!user) {
      user = { id: id('usr'), email: normalizeEmail(email), createdAt: iso() }
      repo.usersByEmail.set(user.email, user)
      repo.users.set(user.id, user)
    }
    const tokens = tokenPair(user)
    await repo.persist()
    return tokens
  })
  app.post('/v1/auth/refresh', async (request, reply) => {
    const { refreshToken } = (request.body ?? {}) as { refreshToken?: unknown }
    if (typeof refreshToken !== 'string') return error(reply, 401, 'AUTH_REQUIRED', '刷新令牌无效')
    const key = hash(refreshToken)
    const userId = repo.refreshTokens.get(key)
    repo.refreshTokens.delete(key)
    const user = userId && repo.users.get(userId)
    if (!user) return error(reply, 401, 'AUTH_REQUIRED', '刷新令牌无效')
    const tokens = tokenPair(user)
    await repo.persist()
    return tokens
  })
  const adminLoginAttempts = new Map<string, number[]>()
  app.post('/v1/admin/auth/login', async (request, reply) => {
    if (!adminPassword)
      return error(reply, 503, 'ADMIN_CONSOLE_DISABLED', '后台管理尚未配置独立登录密码')
    const attempts = (adminLoginAttempts.get(request.ip) ?? []).filter(
      (attemptAt) => now() - attemptAt < 10 * 60_000
    )
    if (attempts.length >= 5)
      return error(reply, 429, 'RATE_LIMITED', '登录尝试过多，请 10 分钟后再试')
    const { password } = (request.body ?? {}) as { password?: unknown }
    if (
      typeof password !== 'string' ||
      password.length !== adminPassword.length ||
      !timingSafeEqual(Buffer.from(password), Buffer.from(adminPassword))
    ) {
      attempts.push(now())
      adminLoginAttempts.set(request.ip, attempts)
      return error(reply, 401, 'ADMIN_AUTH_FAILED', '管理密码不正确')
    }
    adminLoginAttempts.delete(request.ip)
    addAudit('admin.login', undefined, { ip: request.ip })
    await repo.persist()
    return { accessToken: sign({ role: 'admin', exp: now() + 8 * 60 * 60_000 }), expiresInSeconds: 28800 }
  })
  app.get('/v1/admin/overview', async (request, reply) => {
    if (!requireAdminSession(request, reply)) return
    const users = [...repo.users.values()]
    const orders = [...repo.orders.values()]
    const codes = [...repo.activationCodes.values()]
    const today = new Date().toISOString().slice(0, 10)
    return {
      metrics: {
        totalUsers: users.length,
        newUsersToday: users.filter((user) => user.createdAt.slice(0, 10) === today).length,
        activeSessions: [...repo.sessions.values()].filter(
          (session) => !session.stoppedAt && Date.parse(session.expiresAt) > now()
        ).length,
        paidOrders: orders.filter((order) => order.status === 'paid').length,
        paidRevenueFen: orders
          .filter((order) => order.status === 'paid')
          .reduce((sum, order) => sum + order.amountFen, 0),
        pendingOrders: orders.filter(
          (order) => order.status === 'pending' && Date.parse(order.expiresAt) > now()
        ).length,
        activationCodes: {
          total: codes.length,
          redeemed: codes.filter((code) => Boolean(code.redeemedAt)).length,
          valid: codes.filter(
            (code) => !code.redeemedAt && !code.revokedAt && Date.parse(code.expiresAt) > now()
          ).length
        }
      },
      generatedAt: iso()
    }
  })
  app.get('/v1/admin/users', async (request, reply) => {
    if (!requireAdminSession(request, reply)) return
    const { query, limit } = request.query as { query?: string; limit?: string }
    const normalizedQuery = query?.trim().toLowerCase() ?? ''
    const requestedLimit = Number(limit ?? 50)
    const safeLimit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50
    const users = [...repo.users.values()]
      .filter((user) => !normalizedQuery || user.email.includes(normalizedQuery) || user.id.includes(normalizedQuery))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, safeLimit)
      .map((user) => ({
        ...user,
        trialUsed: repo.trialUsed.has(user.id),
        voiceTrialRemaining: Math.max(0, 3 - (repo.voiceUses.get(user.id) ?? 0)),
        passes: {
          total: activePasses(user.id).reduce((sum, pass) => sum + pass.count, 0),
          paid: passCount(user.id, 'paid'),
          activation: passCount(user.id, 'activation')
        },
        activeSession: activeSession(user.id) ?? null
      }))
    return { users, total: users.length }
  })
  app.get('/v1/admin/orders', async (request, reply) => {
    if (!requireAdminSession(request, reply)) return
    const { status, limit } = request.query as { status?: string; limit?: string }
    const requestedLimit = Number(limit ?? 100)
    const safeLimit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100
    const orders = [...repo.orders.values()]
      .filter((order) => !status || order.status === status)
      .sort((left, right) => right.expiresAt.localeCompare(left.expiresAt))
      .slice(0, safeLimit)
      .map((order) => ({ ...order, userEmail: repo.users.get(order.userId)?.email ?? '已删除用户' }))
    return { orders, total: orders.length }
  })
  app.get('/v1/admin/activation-codes', async (request, reply) => {
    if (!requireAdminSession(request, reply)) return
    const codes = [...repo.activationCodes.entries()]
      .map(([codeHash, code]) => ({
        id: `code_${codeHash.slice(0, 12)}`,
        codeHint: code.codeHint ?? '历史体验码',
        batchId: code.batchId ?? 'legacy',
        label: code.label ?? '',
        createdAt: code.createdAt,
        expiresAt: code.expiresAt,
        redeemedAt: code.redeemedAt ?? null,
        redeemedBy: code.redeemedBy ? repo.users.get(code.redeemedBy)?.email ?? '已删除用户' : null,
        revokedAt: code.revokedAt ?? null
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 200)
    return { codes, total: codes.length }
  })
  app.get('/v1/admin/audit-events', async (request, reply) => {
    if (!requireAdminSession(request, reply)) return
    return { events: repo.adminAuditEvents.slice(0, 100) }
  })
  app.post('/v1/admin/users/:id/passes', async (request, reply) => {
    if (!requireAdminSession(request, reply)) return
    const user = repo.users.get((request.params as { id: string }).id)
    if (!user) return error(reply, 404, 'USER_NOT_FOUND', '用户不存在')
    const { count, expiresInDays, reason } = (request.body ?? {}) as {
      count?: unknown
      expiresInDays?: unknown
      reason?: unknown
    }
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 100)
      return error(reply, 400, 'INVALID_COUNT', '补发次数需为 1 到 100')
    if (
      typeof expiresInDays !== 'number' ||
      !Number.isInteger(expiresInDays) ||
      expiresInDays < 1 ||
      expiresInDays > 365
    )
      return error(reply, 400, 'INVALID_EXPIRY', '有效期需为 1 到 365 天')
    const safeReason = typeof reason === 'string' ? reason.trim().slice(0, 100) : ''
    repo.passes.set(user.id, [
      ...(repo.passes.get(user.id) ?? []),
      { count, expiresAt: now() + expiresInDays * 86400_000, kind: 'manual' }
    ])
    addAudit('pass.granted', user.email, { count, expiresInDays, reason: safeReason || '未填写' })
    await repo.persist()
    return { granted: true, entitlements: entitlement(user) }
  })
  app.post('/v1/admin/activation-codes/generate', async (request, reply) => {
    if (!requireAdminSession(request, reply)) return
    const { count: requestedCount, expiresInDays: requestedExpiry, label } = (request.body ?? {}) as {
      count?: unknown
      expiresInDays?: unknown
      label?: unknown
    }
    const count =
      typeof requestedCount === 'number' && Number.isInteger(requestedCount) ? requestedCount : 1
    const expiresInDays =
      typeof requestedExpiry === 'number' && Number.isInteger(requestedExpiry) ? requestedExpiry : 30
    if (count < 1 || count > 100)
      return error(reply, 400, 'INVALID_COUNT', '每次可生成 1 到 100 个体验码')
    if (expiresInDays < 1 || expiresInDays > 365)
      return error(reply, 400, 'INVALID_EXPIRY', '体验码有效期需为 1 到 365 天')
    const safeLabel = typeof label === 'string' ? label.trim().slice(0, 60) : ''
    const expiresAt = iso(now() + expiresInDays * 86400_000)
    const batchId = id('batch')
    const codes: string[] = []
    while (codes.length < count) {
      const code = activationCode()
      const codeHash = hash(normalizeActivationCode(code))
      if (repo.activationCodes.has(codeHash)) continue
      repo.activationCodes.set(codeHash, {
        createdAt: iso(),
        expiresAt,
        batchId,
        label: safeLabel,
        codeHint: `••••${code.slice(-4)}`
      })
      codes.push(code)
    }
    addAudit('activation.generated', batchId, { count, expiresInDays, label: safeLabel || '未命名' })
    await repo.persist()
    return { codes, batchId, expiresAt, benefit: { screenshotMinutes: 60, voiceMinutes: 45 } }
  })
  app.post('/v1/admin/activation-codes/revoke', async (request, reply) => {
    if (!requireAdminSession(request, reply)) return
    const { code, reason } = (request.body ?? {}) as { code?: unknown; reason?: unknown }
    if (typeof code !== 'string') return error(reply, 400, 'INVALID_ACTIVATION_CODE', '体验码格式不正确')
    const record = repo.activationCodes.get(hash(normalizeActivationCode(code)))
    if (!record) return error(reply, 404, 'ACTIVATION_CODE_NOT_FOUND', '未找到体验码')
    if (record.redeemedAt) return error(reply, 409, 'ACTIVATION_CODE_USED', '已兑换的体验码不能撤销')
    record.revokedAt = iso()
    record.revokedReason = typeof reason === 'string' ? reason.trim().slice(0, 100) : ''
    addAudit('activation.revoked', record.codeHint, { reason: record.revokedReason || '未填写' })
    await repo.persist()
    return { revoked: true }
  })
  app.post('/v1/admin/activation-codes', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const { count: requestedCount, expiresInDays: requestedExpiry, label } = (request.body ?? {}) as {
      count?: unknown
      expiresInDays?: unknown
      label?: unknown
    }
    const count =
      typeof requestedCount === 'number' && Number.isInteger(requestedCount) ? requestedCount : 1
    const expiresInDays =
      typeof requestedExpiry === 'number' && Number.isInteger(requestedExpiry)
        ? requestedExpiry
        : 30
    if (count < 1 || count > 100)
      return error(reply, 400, 'INVALID_COUNT', '每次可生成 1 到 100 个体验码')
    if (expiresInDays < 1 || expiresInDays > 365)
      return error(reply, 400, 'INVALID_EXPIRY', '体验码有效期需为 1 到 365 天')

    const expiresAt = iso(now() + expiresInDays * 86400_000)
    const batchId = id('batch')
    const safeLabel = typeof label === 'string' ? label.trim().slice(0, 60) : ''
    const codes: string[] = []
    while (codes.length < count) {
      const code = activationCode()
      const codeHash = hash(normalizeActivationCode(code))
      if (repo.activationCodes.has(codeHash)) continue
      repo.activationCodes.set(codeHash, {
        createdAt: iso(),
        expiresAt,
        batchId,
        label: safeLabel,
        codeHint: `••••${code.slice(-4)}`
      })
      codes.push(code)
    }
    await repo.persist()
    addAudit('activation.generated', batchId, { count, expiresInDays, label: safeLabel || '未命名' })
    await repo.persist()
    return { codes, batchId, expiresAt, benefit: { screenshotMinutes: 60, voiceMinutes: 45 } }
  })
  app.post('/v1/activation-codes/redeem', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const attemptKey = `${user.id}:${request.ip}`
    const recentAttempts = (redemptionAttempts.get(attemptKey) ?? []).filter(
      (attemptAt) => now() - attemptAt < 10 * 60_000
    )
    if (recentAttempts.length >= 8)
      return error(reply, 429, 'RATE_LIMITED', '尝试次数过多，请 10 分钟后再试')
    recentAttempts.push(now())
    redemptionAttempts.set(attemptKey, recentAttempts)

    const { code } = (request.body ?? {}) as { code?: unknown }
    if (
      typeof code !== 'string' ||
      !/^OGET(?:-[A-Z2-9]{4}){4}$/.test(normalizeActivationCode(code))
    )
      return error(reply, 400, 'INVALID_ACTIVATION_CODE', '体验码格式不正确')
    const record = repo.activationCodes.get(hash(normalizeActivationCode(code)))
    if (!record) return error(reply, 400, 'INVALID_ACTIVATION_CODE', '体验码无效')
    if (record.revokedAt) return error(reply, 410, 'ACTIVATION_CODE_REVOKED', '该体验码已被撤销')
    if (record.redeemedAt) return error(reply, 409, 'ACTIVATION_CODE_USED', '该体验码已被使用')
    if (Date.parse(record.expiresAt) <= now())
      return error(reply, 410, 'ACTIVATION_CODE_EXPIRED', '该体验码已过期')

    record.redeemedAt = iso()
    record.redeemedBy = user.id
    repo.passes.set(user.id, [
      ...(repo.passes.get(user.id) ?? []),
      { count: 1, expiresAt: now() + 30 * 86400_000, kind: 'activation' }
    ])
    redemptionAttempts.delete(attemptKey)
    await repo.persist()
    return {
      redeemed: true,
      benefit: { interviews: 1, screenshotMinutes: 60, voiceMinutes: 45 },
      entitlements: entitlement(user)
    }
  })
  app.get('/v1/me/entitlements', async (request, reply) => {
    const user = requireUser(request, reply)
    return user ? entitlement(user) : undefined
  })
  app.post('/v1/practice-sessions/start', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const existing = activeSession(user.id)
    if (existing) return { session: existing, reused: true }
    let kind: Session['kind']
    if (!repo.trialUsed.has(user.id)) {
      repo.trialUsed.add(user.id)
      kind = 'trial'
    } else {
      const pass =
        activePasses(user.id).find((candidate) => candidate.kind === 'activation') ??
        activePasses(user.id)[0]
      if (!pass) return error(reply, 403, 'NO_ENTITLEMENT', '没有可用次卡')
      pass.count -= 1
      kind = pass.kind === 'activation' ? 'activation' : 'paid'
    }
    const duration = kind === 'trial' ? 45 : 60
    const startedAt = now()
    const session: Session = {
      id: id('ps'),
      userId: user.id,
      kind,
      startedAt: iso(startedAt),
      expiresAt: iso(startedAt + duration * 60_000),
      ...(kind === 'activation' ? { voiceExpiresAt: iso(startedAt + 45 * 60_000) } : {})
    }
    repo.sessions.set(session.id, session)
    await repo.persist()
    return { session, reused: false }
  })
  app.post('/v1/practice-sessions/:id/stop', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const session = repo.sessions.get((request.params as { id: string }).id)
    if (!session || session.userId !== user.id)
      return error(reply, 404, 'NO_ACTIVE_SESSION', '练习会话不存在')
    session.stoppedAt = iso()
    repo.asrClosers.get(session.id)?.()
    await repo.persist()
    return { session }
  })
  app.post('/v1/asr-trials/start', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (!asrProvider) return error(reply, 503, 'ASR_UNAVAILABLE', '服务器尚未配置语音识别服务')
    const { sessionId } = (request.body ?? {}) as { sessionId?: string }
    const session = sessionId && repo.sessions.get(sessionId)
    if (!session || session.userId !== user.id || session.stoppedAt)
      return error(reply, 403, 'NO_ACTIVE_SESSION', '需要活跃练习会话')
    if (Date.parse(session.expiresAt) <= now())
      return error(reply, 403, 'SESSION_EXPIRED', '练习会话已到期')
    if (
      session.kind === 'activation' &&
      session.voiceExpiresAt &&
      Date.parse(session.voiceExpiresAt) <= now()
    )
      return error(reply, 403, 'VOICE_ENTITLEMENT_EXPIRED', '本场体验码的 45 分钟语音权益已结束')
    if (repo.asrConnecting.has(session.id) || repo.activeAsrSessions.has(session.id))
      return error(reply, 409, 'ASR_ALREADY_ACTIVE', '本场面试的语音识别已在运行')
    const idempotencyKey = request.headers['idempotency-key']
    const requestKey =
      typeof idempotencyKey === 'string' ? `${user.id}:${idempotencyKey}` : undefined
    const existing = requestKey && repo.asrStartKeys.get(requestKey)
    if (existing && existing.expiresAt > now() && !existing.consumed)
      return {
        asrSession: existing.asrSession,
        streamTicket: existing.ticket,
        reused: true
      }
    if (session.kind === 'trial') {
      const used = repo.voiceUses.get(user.id) ?? 0
      const pending = pendingVoiceReservations(user.id)
      if (used + pending >= 3) return error(reply, 403, 'NO_ENTITLEMENT', '免费语音次数已用完')
    }
    const asrSession: AsrSession = {
      id: id('asr'),
      practiceSessionId: session.id,
      userId: user.id,
      expiresAt:
        session.kind === 'paid'
          ? session.expiresAt
          : session.kind === 'activation'
            ? session.voiceExpiresAt!
            : iso(Math.min(Date.parse(session.expiresAt), now() + 15 * 60_000)),
      billed: false
    }
    const ticket: AsrTicket = {
      ticket: id('ast'),
      asrSession,
      expiresAt: now() + 60_000,
      consumed: false
    }
    repo.asrTickets.set(ticket.ticket, ticket)
    if (requestKey) repo.asrStartKeys.set(requestKey, ticket)
    return { asrSession, streamTicket: ticket.ticket, reused: false }
  })
  app.post('/v1/checkout-sessions', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const { productCode } = (request.body ?? {}) as { productCode?: ProductCode }
    const product = productCode && PRODUCTS[productCode]
    if (!product) return error(reply, 400, 'ORDER_NOT_FOUND', '商品不存在')
    const key = request.headers['idempotency-key']
    if (typeof key === 'string' && repo.checkoutKeys.has(`${user.id}:${key}`))
      return {
        order: repo.orders.get(repo.checkoutKeys.get(`${user.id}:${key}`)!),
        payment: { provider: 'mock', qrData: 'mock://reused' }
      }
    const order: Order = {
      orderNo: id('ord'),
      userId: user.id,
      productCode,
      amountFen: product.amountFen,
      status: 'pending',
      passesGranted: 0,
      expiresAt: iso(now() + 15 * 60_000)
    }
    repo.orders.set(order.orderNo, order)
    if (typeof key === 'string') repo.checkoutKeys.set(`${user.id}:${key}`, order.orderNo)
    await repo.persist()
    return { order, payment: { provider: 'mock', qrData: `mock://pay/${order.orderNo}` } }
  })
  app.get('/v1/orders/:orderNo', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const order = repo.orders.get((request.params as { orderNo: string }).orderNo)
    return order && order.userId === user.id
      ? { order }
      : error(reply, 404, 'ORDER_NOT_FOUND', '订单不存在')
  })
  app.post('/v1/dev/orders/:orderNo/mark-paid', async (request, reply) => {
    if (!devCodes) return error(reply, 404, 'ORDER_NOT_FOUND', '开发接口未启用')
    const order = repo.orders.get((request.params as { orderNo: string }).orderNo)
    if (!order) return error(reply, 404, 'ORDER_NOT_FOUND', '订单不存在')
    if (!repo.paidEvents.has(order.orderNo)) {
      const product = PRODUCTS[order.productCode]
      repo.passes.set(order.userId, [
        ...(repo.passes.get(order.userId) ?? []),
        {
          count: product.passes,
          expiresAt: now() + product.passDays * 86400_000,
          kind: 'paid'
        }
      ])
      order.status = 'paid'
      order.passesGranted = product.passes
      order.fulfilledAt = iso()
      repo.paidEvents.add(order.orderNo)
      await repo.persist()
    }
    return { order: repo.orders.get(order.orderNo) }
  })
  app.post('/v1/ai/answer', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const { sessionId, requestId, prompt, systemPrompt } = (request.body ?? {}) as {
      sessionId?: string
      requestId?: string
      prompt?: string
      systemPrompt?: string
    }
    const session = sessionId && repo.sessions.get(sessionId)
    if (!session || session.userId !== user.id || session.stoppedAt)
      return error(reply, 403, 'NO_ACTIVE_SESSION', '需要活跃练习会话')
    if (Date.parse(session.expiresAt) <= now())
      return error(reply, 403, 'SESSION_EXPIRED', '练习会话已到期')
    if (!visionProvider) return error(reply, 503, 'MODEL_UNAVAILABLE', '服务器尚未配置问答模型')
    if (
      !requestId ||
      typeof prompt !== 'string' ||
      !prompt.trim() ||
      prompt.length > 20_000 ||
      (systemPrompt?.length ?? 0) > 20_000
    )
      return error(reply, 400, 'INVALID_PROMPT', '语音问题为空或上下文过长')

    const dedupeKey = `${user.id}:voice:${requestId}`
    const cached = repo.screenshotRequests.get(dedupeKey)
    const wantsStream =
      request.headers.accept?.includes('application/x-ndjson') && Boolean(visionProvider.stream)
    if (wantsStream) {
      reply.header('content-type', 'application/x-ndjson; charset=utf-8')
      reply.header('cache-control', 'no-cache, no-transform')
      reply.header('x-accel-buffering', 'no')
      const responseStream = async function* () {
        const startedAt = Date.now()
        if (cached) {
          yield `${JSON.stringify({ type: 'delta', text: cached })}\n`
          yield `${JSON.stringify({ type: 'done', reused: true, totalMs: Date.now() - startedAt })}\n`
          return
        }
        let answer = ''
        let firstChunkAt: number | undefined
        try {
          for await (const chunk of visionProvider.stream!({
            images: [],
            prompt: prompt.trim(),
            systemPrompt
          })) {
            if (!chunk) continue
            firstChunkAt ??= Date.now()
            answer += chunk
            yield `${JSON.stringify({ type: 'delta', text: chunk })}\n`
          }
          if (!answer) throw new Error('模型没有返回有效内容')
          repo.screenshotRequests.set(dedupeKey, answer)
          request.log.info(
            {
              requestId,
              firstChunkMs: firstChunkAt ? firstChunkAt - startedAt : undefined,
              totalMs: Date.now() - startedAt
            },
            'Voice question answer stream completed'
          )
          yield `${JSON.stringify({
            type: 'done',
            firstChunkMs: firstChunkAt ? firstChunkAt - startedAt : undefined,
            totalMs: Date.now() - startedAt
          })}\n`
        } catch (providerError) {
          request.log.error({ err: providerError }, 'Voice question answer stream failed')
          const providerMessage =
            providerError instanceof Error ? providerError.message : '模型回答暂时失败'
          yield `${JSON.stringify({
            type: 'error',
            code: providerMessage.includes('超时')
              ? 'MODEL_PROVIDER_TIMEOUT'
              : 'MODEL_PROVIDER_ERROR',
            message: providerMessage.includes('超时')
              ? '模型响应超时，请重试'
              : '模型回答暂时失败，请稍后重试'
          })}\n`
        }
      }
      return reply.send(Readable.from(responseStream()))
    }
    if (cached) return { answer: cached, reused: true }
    try {
      const answer = await visionProvider.analyze({
        images: [],
        prompt: prompt.trim(),
        systemPrompt
      })
      repo.screenshotRequests.set(dedupeKey, answer)
      return { answer }
    } catch (providerError) {
      request.log.error({ err: providerError }, 'Voice question answer provider failed')
      const providerMessage =
        providerError instanceof Error ? providerError.message : '模型回答暂时失败'
      if (providerMessage.includes('超时')) {
        return error(reply, 504, 'MODEL_PROVIDER_TIMEOUT', '模型响应超时，请重试')
      }
      return error(reply, 502, 'MODEL_PROVIDER_ERROR', '模型回答暂时失败，请稍后重试')
    }
  })
  app.post('/v1/ai/screenshot', { bodyLimit: 30 * 1024 * 1024 }, async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const { sessionId, requestId, image, images, prompt, systemPrompt, messages } = (request.body ??
      {}) as {
      sessionId?: string
      requestId?: string
      image?: string
      images?: string[]
      prompt?: string
      systemPrompt?: string
      messages?: VisionConversationMessage[]
    }
    const session = sessionId && repo.sessions.get(sessionId)
    if (!session || session.userId !== user.id || session.stoppedAt)
      return error(reply, 403, 'NO_ACTIVE_SESSION', '需要活跃练习会话')
    if (Date.parse(session.expiresAt) <= now())
      return error(reply, 403, 'SESSION_EXPIRED', '练习会话已到期')
    if (!visionProvider)
      return error(reply, 503, 'VISION_UNAVAILABLE', '服务器尚未配置截图识别模型')
    const messageImages = Array.isArray(messages)
      ? messages.flatMap((message) => (Array.isArray(message?.images) ? message.images : []))
      : []
    const inputImages = Array.isArray(images) ? images : image ? [image] : messageImages
    const validMessages =
      messages === undefined ||
      (Array.isArray(messages) &&
        messages.length > 0 &&
        messages.length <= 12 &&
        messages.every(
          (message) =>
            (message.role === 'user' || message.role === 'assistant') &&
            typeof message.text === 'string' &&
            (message.images === undefined ||
              (Array.isArray(message.images) &&
                message.images.every((value) => typeof value === 'string' && value.length > 0)))
        ))
    const messageTextLength = Array.isArray(messages)
      ? messages.reduce(
          (size, message) => size + (typeof message?.text === 'string' ? message.text.length : 0),
          0
        )
      : 0
    if (
      !requestId ||
      inputImages.length === 0 ||
      inputImages.length > 5 ||
      inputImages.some((value) => typeof value !== 'string' || value.length === 0) ||
      inputImages.reduce((size, value) => size + value.length, 0) > 25 * 1024 * 1024 ||
      !validMessages ||
      messageImages.length > 5 ||
      messageImages.reduce((size, value) => size + value.length, 0) > 25 * 1024 * 1024 ||
      messageTextLength > 20_000
    )
      return error(reply, 400, 'INVALID_SCREENSHOT', '截图请求参数无效或图片过大')
    if ((prompt?.length ?? 0) > 20_000 || (systemPrompt?.length ?? 0) > 20_000)
      return error(reply, 400, 'INVALID_PROMPT', '题目上下文过长')

    const dedupeKey = `${user.id}:${requestId}`
    const cached = repo.screenshotRequests.get(dedupeKey)
    const wantsStream =
      request.headers.accept?.includes('application/x-ndjson') && Boolean(visionProvider.stream)
    if (wantsStream) {
      reply.header('content-type', 'application/x-ndjson; charset=utf-8')
      reply.header('cache-control', 'no-cache, no-transform')
      reply.header('x-accel-buffering', 'no')
      const responseStream = async function* () {
        const startedAt = Date.now()
        if (cached) {
          yield `${JSON.stringify({ type: 'delta', text: cached })}\n`
          yield `${JSON.stringify({
            type: 'done',
            reused: true,
            totalMs: Date.now() - startedAt
          })}\n`
          return
        }
        let answer = ''
        let firstChunkAt: number | undefined
        try {
          for await (const chunk of visionProvider.stream!({
            images: inputImages,
            prompt: prompt || '请识别并解答截图中的面试题。',
            systemPrompt,
            ...(messages ? { messages } : {})
          })) {
            if (!chunk) continue
            firstChunkAt ??= Date.now()
            answer += chunk
            yield `${JSON.stringify({ type: 'delta', text: chunk })}\n`
          }
          if (!answer) throw new Error('视觉模型没有返回有效内容')
          repo.screenshotRequests.set(dedupeKey, answer)
          request.log.info(
            {
              requestId,
              imageCount: inputImages.length,
              firstChunkMs: firstChunkAt ? firstChunkAt - startedAt : undefined,
              totalMs: Date.now() - startedAt
            },
            'Screenshot recognition stream completed'
          )
          yield `${JSON.stringify({
            type: 'done',
            firstChunkMs: firstChunkAt ? firstChunkAt - startedAt : undefined,
            totalMs: Date.now() - startedAt
          })}\n`
        } catch (providerError) {
          request.log.error({ err: providerError }, 'Screenshot recognition stream failed')
          const providerMessage =
            providerError instanceof Error ? providerError.message : '截图识别暂时失败'
          yield `${JSON.stringify({
            type: 'error',
            code: providerMessage.includes('超时')
              ? 'VISION_PROVIDER_TIMEOUT'
              : 'VISION_PROVIDER_ERROR',
            message: providerMessage.includes('超时')
              ? '模型响应超时，请重新截屏'
              : '截图识别暂时失败，请稍后重试'
          })}\n`
        }
      }
      return reply.send(Readable.from(responseStream()))
    }
    if (cached) return { answer: cached, reused: true }
    try {
      const answer = await visionProvider.analyze({
        images: inputImages,
        prompt: prompt || '请识别并解答截图中的面试题。',
        systemPrompt,
        ...(messages ? { messages } : {})
      })
      repo.screenshotRequests.set(dedupeKey, answer)
      return { answer }
    } catch (providerError) {
      request.log.error({ err: providerError }, 'Screenshot recognition provider failed')
      const providerMessage =
        providerError instanceof Error ? providerError.message : '截图识别暂时失败'
      if (providerMessage.includes('超时')) {
        return error(reply, 504, 'VISION_PROVIDER_TIMEOUT', '模型响应超时，请重新截屏')
      }
      return error(reply, 502, 'VISION_PROVIDER_ERROR', '截图识别暂时失败，请稍后重试')
    }
  })
  return app
}
