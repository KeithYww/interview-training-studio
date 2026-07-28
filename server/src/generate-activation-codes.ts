import { config } from 'dotenv'

config({ path: 'server/.env', quiet: true })
config({ quiet: true })

function integerArgument(name: string, fallback: number) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isInteger(value)) throw new Error(`${name} 必须是整数`)
  return value
}

async function main() {
  const count = integerArgument('--count', 1)
  const expiresInDays = integerArgument('--expires-days', 30)
  const baseUrl = (process.env.OFFERGET_API_URL?.trim() || 'http://127.0.0.1:3001').replace(
    /\/$/,
    ''
  )
  const adminSecret = process.env.ACTIVATION_ADMIN_SECRET?.trim() || process.env.APP_SECRET?.trim()
  if (!adminSecret) {
    throw new Error('请配置 ACTIVATION_ADMIN_SECRET（或 APP_SECRET）后再生成体验码')
  }

  const response = await fetch(`${baseUrl}/v1/admin/activation-codes`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-activation-admin-secret': adminSecret
    },
    body: JSON.stringify({ count, expiresInDays })
  })
  const body = (await response.json().catch(() => ({}))) as {
    codes?: string[]
    expiresAt?: string
    error?: { message?: string }
  }
  if (!response.ok || !body.codes) {
    throw new Error(body.error?.message || `生成失败（HTTP ${response.status}）`)
  }

  console.log(`已生成 ${body.codes.length} 个 offerGet 体验码，有效期至 ${body.expiresAt}`)
  console.log('每个体验码可兑换 1 次面试：截图 60 分钟，语音识别 45 分钟')
  for (const code of body.codes) console.log(code)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '体验码生成失败')
  process.exitCode = 1
})
