# offerGet P0 API

服务端包含 QQ 邮箱验证码、SMTP 邮件发送、权益、练习会话、体验码、模拟支付发卡、实时语音和截图视觉模型网关。本地未配置 `DATABASE_URL` 时使用内存数据；生产环境使用 PostgreSQL 持久化。

```bash
cp server/.env.example server/.env
npm run server:dev
npm run server:test
```

默认联调地址是 `http://127.0.0.1:3001`。开发模式 `POST /v1/auth/send-email-code` 返回 `devCode`；`POST /v1/dev/orders/:orderNo/mark-paid` 模拟可信支付回调，重复调用不会重复发卡。

## 接通 QQ 邮箱 SMTP

在 `server/.env` 中配置：

```env
DEV_EMAIL_CODES=false
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的发件QQ邮箱@qq.com
SMTP_PASS=QQ邮箱生成的SMTP授权码
SMTP_FROM=offerGet <你的发件QQ邮箱@qq.com>
```

`SMTP_PASS` 必须使用 QQ 邮箱中开启 SMTP 服务后生成的授权码，不要填写邮箱登录密码。服务启动时会先验证 SMTP 连接；验证失败则拒绝启动。生产模式接口只返回 `sent: true`，不会向客户端返回验证码明文。

## 接通实时语音识别

语音使用百炼 Fun-ASR WebSocket，由 offerGet 服务端持有密钥并转发，客户端不会接触供应商凭证：

```env
DASHSCOPE_API_KEY=你的百炼API Key
DASHSCOPE_ASR_MODEL=fun-asr-realtime
DASHSCOPE_ASR_WS_URL=wss://dashscope.aliyuncs.com/api-ws/v1/inference
```

免费用户每次最多 15 分钟，共 3 次；只有百炼返回 `task-started` 后才扣 1 次。付费面试在本场剩余时间内使用语音不会额外扣次，体验码面试可使用前 45 分钟语音能力。

## 接通截图识别

截图识别通过服务端调用硅基流动的 OpenAI 兼容视觉接口，与百炼语音识别使用不同密钥：

```env
SILICONFLOW_API_KEY=你的硅基流动API Key
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_VISION_MODEL=Qwen/Qwen3-VL-32B-Instruct
SILICONFLOW_IMAGE_DETAIL=high
SILICONFLOW_VISION_TIMEOUT_MS=45000
```

客户端只上传当前面试的截图、语音转录文本和场景提示词，无法读取模型密钥。未配置密钥时接口返回
`VISION_UNAVAILABLE`，不会再返回 Mock 假答案。

## 体验码生成器

体验码只能由服务端生成，数据库仅保存不可逆哈希。每个码只能成功兑换一次，兑换后到账
1 次面试权益：截图识别 60 分钟、语音识别 45 分钟。

本地服务启动后执行：

```bash
ACTIVATION_ADMIN_SECRET=your-admin-secret \
OFFERGET_API_URL=http://127.0.0.1:3001 \
npm run activation:generate -- --count 10 --expires-days 30
```

生产容器中执行（密钥由容器环境自动读取，不会出现在命令历史中）：

```bash
docker compose exec backend npm run activation:generate -- --count 10 --expires-days 30
```

`--count` 每次允许 1–100，`--expires-days` 允许 1–365。体验码明文只在生成时输出一次，
请妥善保存；服务端无法从哈希恢复原始体验码。

生产替换点：将 `MemoryRepository` 替换为具备事务的 PostgreSQL 仓储，将 Mock 支付适配器替换为微信 Native。不要将 `APP_SECRET`、邮件授权码或模型密钥放入客户端或日志。
