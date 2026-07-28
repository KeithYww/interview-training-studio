import { config } from 'dotenv'
import { buildApp, MemoryRepository } from './app'
import { createDashScopeAsrProviderFromEnv } from './asr'
import { createSmtpEmailSenderFromEnv } from './email'
import { createVisionProviderFromEnv } from './vision'
import { PostgresRepository } from './postgres'

config({ path: 'server/.env' })
config()

const port = Number(process.env.PORT ?? 3001)
async function start() {
  try {
    const devCodes = process.env.DEV_EMAIL_CODES !== 'false'
    const emailSender = createSmtpEmailSenderFromEnv()
    if (!devCodes && !emailSender) {
      throw new Error('生产邮件模式已启用，但未配置 SMTP_HOST/SMTP_USER/SMTP_PASS')
    }
    if (emailSender) await emailSender.verify()
    const asrProvider = createDashScopeAsrProviderFromEnv()
    const visionProvider = createVisionProviderFromEnv()
    const repository = process.env.DATABASE_URL
      ? await PostgresRepository.create(process.env.DATABASE_URL)
      : new MemoryRepository()
    const app = buildApp({
      devCodes,
      emailSender,
      asrProvider,
      visionProvider,
      repository
    })
    await app.listen({ host: process.env.HOST || '127.0.0.1', port })
    console.log(`offerGet API listening on http://127.0.0.1:${port}`)
    if (!asrProvider)
      console.warn('Voice recognition disabled: DASHSCOPE_API_KEY is not configured')
    if (!visionProvider)
      console.warn('Screenshot recognition disabled: SILICONFLOW_API_KEY is not configured')
    if (!process.env.DATABASE_URL)
      console.warn('Persistence disabled: DATABASE_URL is not configured')
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

void start()
