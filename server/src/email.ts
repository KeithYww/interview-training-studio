import nodemailer from 'nodemailer'

export type VerificationEmail = {
  to: string
  code: string
  expiresInMinutes: number
}

export type EmailSender = {
  verify: () => Promise<void>
  sendVerificationCode: (message: VerificationEmail) => Promise<void>
}

const required = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`缺少服务端环境变量 ${name}`)
  return value
}

export function createSmtpEmailSenderFromEnv(): EmailSender | undefined {
  if (!process.env.SMTP_HOST?.trim()) return undefined

  const host = required('SMTP_HOST')
  const port = Number(process.env.SMTP_PORT ?? 465)
  const secure = process.env.SMTP_SECURE !== 'false'
  const user = required('SMTP_USER')
  const pass = required('SMTP_PASS')
  const from = process.env.SMTP_FROM?.trim() || `offerGet <${user}>`

  if (!Number.isInteger(port) || port <= 0) throw new Error('SMTP_PORT 配置无效')

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000
  })

  return {
    async verify() {
      await transporter.verify()
    },
    async sendVerificationCode({ to, code, expiresInMinutes }) {
      await transporter.sendMail({
        from,
        to,
        subject: `${code} 是你的 offerGet 登录验证码`,
        text: `你的 offerGet 登录验证码是 ${code}，${expiresInMinutes} 分钟内有效。请勿将验证码告诉他人。`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.6">
            <h2 style="margin:0 0 16px">登录 offerGet</h2>
            <p>你的验证码是：</p>
            <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#f97316">${code}</div>
            <p style="color:#64748b">${expiresInMinutes} 分钟内有效。请勿将验证码告诉他人。</p>
            <p style="color:#94a3b8;font-size:12px">如果不是你本人操作，请忽略此邮件。</p>
          </div>
        `
      })
    }
  }
}
