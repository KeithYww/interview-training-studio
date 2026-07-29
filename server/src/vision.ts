const DEFAULT_SYSTEM_PROMPT =
  '你是 offerGet 的面试辅助教练。请准确识别截图中的题目，结合用户提供的上下文，用中文给出清晰、可执行的分析与答案。'
const DEFAULT_VOICE_SYSTEM_PROMPT =
  '你是 offerGet 的实时面试辅助教练。用户输入是面试官语音转写的问题。请直接用中文给出适合面试现场参考的准确答案，先给结论，再给简洁的回答思路；不要提及语音转写。'

export type VisionRequest = {
  images: string[]
  prompt: string
  systemPrompt?: string
  messages?: VisionConversationMessage[]
}

export type VisionConversationMessage = {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
}

export interface VisionProvider {
  analyze(request: VisionRequest): Promise<string>
  stream?(request: VisionRequest): AsyncIterable<string>
}

type ChatCompletionContent = string | Array<{ type?: string; text?: string }>
type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: ChatCompletionContent } }>
  error?: { message?: string }
}
type ChatCompletionStreamEvent = {
  choices?: Array<{ delta?: { content?: ChatCompletionContent } }>
  error?: { message?: string }
}

function normalizeImage(image: string) {
  return image.startsWith('data:') ? image : `data:image/png;base64,${image}`
}

function responseText(content: ChatCompletionContent | undefined) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim()
}

function streamText(content: ChatCompletionContent | undefined) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

function requestBody(
  images: string[],
  prompt: string,
  systemPrompt: string | undefined,
  model: string,
  imageDetail: 'low' | 'auto' | 'high',
  stream: boolean,
  conversation?: VisionConversationMessage[]
) {
  const conversationMessages =
    conversation && conversation.length > 0
      ? conversation.map((message) => ({
          role: message.role,
          content:
            message.role === 'user'
              ? [
                  ...(message.text.trim() ? [{ type: 'text', text: message.text.trim() }] : []),
                  ...(message.images ?? []).map((image) => ({
                    type: 'image_url',
                    image_url: { url: normalizeImage(image), detail: imageDetail }
                  }))
                ]
              : message.text
        }))
      : [
          {
            role: 'user',
            content: [
              ...images.map((image) => ({
                type: 'image_url',
                image_url: { url: normalizeImage(image), detail: imageDetail }
              })),
              { type: 'text', text: prompt.trim() || '请识别并解答截图中的面试题。' }
            ]
          }
        ]
  return {
    model,
    stream,
    messages: [
      {
        role: 'system',
        content:
          systemPrompt?.trim() ||
          (images.length > 0 ? DEFAULT_SYSTEM_PROMPT : DEFAULT_VOICE_SYSTEM_PROMPT)
      },
      ...conversationMessages
    ],
    temperature: 0.2,
    max_tokens: 2_000
  }
}

function providerError(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error('视觉模型响应超时')
  }
  return error
}

export function createVisionProviderFromEnv(): VisionProvider | undefined {
  const apiKey = process.env.SILICONFLOW_API_KEY?.trim()
  if (!apiKey) return undefined

  const baseUrl = (
    process.env.SILICONFLOW_BASE_URL?.trim() || 'https://api.siliconflow.cn/v1'
  ).replace(/\/$/, '')
  const model = process.env.SILICONFLOW_VISION_MODEL?.trim() || 'Qwen/Qwen3-VL-32B-Instruct'
  const configuredDetail = process.env.SILICONFLOW_IMAGE_DETAIL?.trim()
  const imageDetail: 'low' | 'auto' | 'high' =
    configuredDetail === 'low' || configuredDetail === 'auto' ? configuredDetail : 'high'
  const timeoutMs = Math.max(5_000, Number(process.env.SILICONFLOW_VISION_TIMEOUT_MS) || 90_000)

  return {
    async analyze({ images, prompt, systemPrompt, messages }) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify(
            requestBody(images, prompt, systemPrompt, model, imageDetail, false, messages)
          ),
          signal: controller.signal
        })
        const body = (await response.json().catch(() => ({}))) as ChatCompletionResponse
        if (!response.ok) {
          throw new Error(body.error?.message || `视觉模型请求失败（HTTP ${response.status}）`)
        }
        const answer = responseText(body.choices?.[0]?.message?.content)
        if (!answer) throw new Error('视觉模型没有返回有效内容')
        return answer
      } catch (error) {
        throw providerError(error)
      } finally {
        controller.abort()
        clearTimeout(timeout)
      }
    },
    async *stream({ images, prompt, systemPrompt, messages }) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify(
            requestBody(images, prompt, systemPrompt, model, imageDetail, true, messages)
          ),
          signal: controller.signal
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as ChatCompletionResponse
          throw new Error(body.error?.message || `视觉模型请求失败（HTTP ${response.status}）`)
        }
        if (!response.body) throw new Error('视觉模型没有返回数据流')

        const decoder = new TextDecoder()
        let buffer = ''
        let receivedText = false
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') continue
            let event: ChatCompletionStreamEvent
            try {
              event = JSON.parse(data) as ChatCompletionStreamEvent
            } catch {
              continue
            }
            if (event.error?.message) throw new Error(event.error.message)
            const text = streamText(event.choices?.[0]?.delta?.content)
            if (!text) continue
            receivedText = true
            yield text
          }
        }
        if (!receivedText) throw new Error('视觉模型没有返回有效内容')
      } catch (error) {
        throw providerError(error)
      } finally {
        controller.abort()
        clearTimeout(timeout)
      }
    }
  }
}
