import { Pool } from 'pg'
import {
  MemoryRepository,
  type ActivationCode,
  type AdminAuditEvent,
  type Order,
  type PassBalance,
  type Session,
  type User
} from './app'

type RepositorySnapshot = {
  usersByEmail: [string, User][]
  users: [string, User][]
  refreshTokens: [string, string][]
  trialUsed: string[]
  voiceUses: [string, number][]
  passes: [string, PassBalance[]][]
  activationCodes?: [string, ActivationCode][]
  adminAuditEvents?: AdminAuditEvent[]
  sessions: [string, Session][]
  orders: [string, Order][]
  checkoutKeys: [string, string][]
  paidEvents: string[]
}

export class PostgresRepository extends MemoryRepository {
  private writeQueue: Promise<void> = Promise.resolve()

  private constructor(private readonly pool: Pool) {
    super()
  }

  static async create(connectionString: string) {
    const pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    })
    const repository = new PostgresRepository(pool)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS offerget_state (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    const result = await pool.query<{ state: RepositorySnapshot }>(
      'SELECT state FROM offerget_state WHERE singleton = TRUE'
    )
    if (result.rows[0]?.state) repository.restore(result.rows[0].state)
    return repository
  }

  private snapshot(): RepositorySnapshot {
    return {
      usersByEmail: [...this.usersByEmail.entries()],
      users: [...this.users.entries()],
      refreshTokens: [...this.refreshTokens.entries()],
      trialUsed: [...this.trialUsed],
      voiceUses: [...this.voiceUses.entries()],
      passes: [...this.passes.entries()],
      activationCodes: [...this.activationCodes.entries()],
      adminAuditEvents: this.adminAuditEvents,
      sessions: [...this.sessions.entries()],
      orders: [...this.orders.entries()],
      checkoutKeys: [...this.checkoutKeys.entries()],
      paidEvents: [...this.paidEvents]
    }
  }

  private restore(state: RepositorySnapshot) {
    this.usersByEmail = new Map(state.usersByEmail ?? [])
    this.users = new Map(state.users ?? [])
    this.refreshTokens = new Map(state.refreshTokens ?? [])
    this.trialUsed = new Set(state.trialUsed ?? [])
    this.voiceUses = new Map(state.voiceUses ?? [])
    this.passes = new Map(state.passes ?? [])
    this.activationCodes = new Map(state.activationCodes ?? [])
    this.adminAuditEvents = state.adminAuditEvents ?? []
    this.sessions = new Map(state.sessions ?? [])
    this.orders = new Map(state.orders ?? [])
    this.checkoutKeys = new Map(state.checkoutKeys ?? [])
    this.paidEvents = new Set(state.paidEvents ?? [])
  }

  override persist() {
    const state = this.snapshot()
    this.writeQueue = this.writeQueue.then(async () => {
      await this.pool.query(
        `INSERT INTO offerget_state (singleton, state, updated_at)
         VALUES (TRUE, $1::jsonb, NOW())
         ON CONFLICT (singleton)
         DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
        [JSON.stringify(state)]
      )
    })
    return this.writeQueue
  }

  override async health() {
    await this.pool.query('SELECT 1')
    return { database: true, persistent: true }
  }

  override async close() {
    await this.writeQueue
    await this.pool.end()
  }
}
