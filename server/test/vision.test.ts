import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createVisionProviderFromEnv } from '../src/vision'

test('OpenAI 兼容视觉适配器使用服务端密钥并发送 Base64 Data URL', async () => {
  const previous = {
    key: process.env.SILICONFLOW_API_KEY,
    baseUrl: process.env.SILICONFLOW_BASE_URL,
    model: process.env.SILICONFLOW_VISION_MODEL,
    detail: process.env.SILICONFLOW_IMAGE_DETAIL
  }
  let receivedAuthorization = ''
  let receivedBody: Record<string, unknown> | undefined
  const server = createServer((request, response) => {
    receivedAuthorization = request.headers.authorization || ''
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString())
      if (receivedBody?.stream === true) {
        response.setHeader('content-type', 'text/event-stream')
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: '流式' } }] })}\n\n`
        )
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: '返回成功' } }] })}\n\n`
        )
        response.end('data: [DONE]\n\n')
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '兼容接口返回成功' } }]
        })
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    process.env.SILICONFLOW_API_KEY = 'server-only-test-key'
    process.env.SILICONFLOW_BASE_URL = `http://127.0.0.1:${address.port}/v1`
    process.env.SILICONFLOW_VISION_MODEL = 'test-vision-model'
    process.env.SILICONFLOW_IMAGE_DETAIL = 'high'
    const provider = createVisionProviderFromEnv()
    assert.ok(provider)
    const answer = await provider.analyze({
      images: ['raw-base64'],
      prompt: '识别题目',
      systemPrompt: '中文回答'
    })
    assert.equal(answer, '兼容接口返回成功')
    assert.equal(receivedAuthorization, 'Bearer server-only-test-key')
    assert.equal(receivedBody?.model, 'test-vision-model')
    const messages = receivedBody?.messages as Array<{
      role: string
      content: string | Array<{ type: string; image_url?: { url: string } }>
    }>
    assert.equal(messages[0]?.content, '中文回答')
    assert.equal(
      (messages[1]?.content as Array<{ image_url?: { url: string } }>)[0]?.image_url?.url,
      'data:image/png;base64,raw-base64'
    )
    assert.equal(
      (messages[1]?.content as Array<{ image_url?: { detail?: string } }>)[0]?.image_url
        ?.detail,
      'high'
    )
    assert.ok(provider.stream)
    const streamed: string[] = []
    for await (const chunk of provider.stream({
      images: ['raw-base64'],
      prompt: '识别题目',
      systemPrompt: '中文回答'
    })) {
      streamed.push(chunk)
    }
    assert.deepEqual(streamed, ['流式', '返回成功'])
    assert.equal(receivedBody?.stream, true)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
    if (previous.key === undefined) delete process.env.SILICONFLOW_API_KEY
    else process.env.SILICONFLOW_API_KEY = previous.key
    if (previous.baseUrl === undefined) delete process.env.SILICONFLOW_BASE_URL
    else process.env.SILICONFLOW_BASE_URL = previous.baseUrl
    if (previous.model === undefined) delete process.env.SILICONFLOW_VISION_MODEL
    else process.env.SILICONFLOW_VISION_MODEL = previous.model
    if (previous.detail === undefined) delete process.env.SILICONFLOW_IMAGE_DETAIL
    else process.env.SILICONFLOW_IMAGE_DETAIL = previous.detail
  }
})
