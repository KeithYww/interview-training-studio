const DEFAULT_SYSTEM_PROMPT =
  '你是 offerGet 的面试辅助教练。请准确识别截图中的题目，结合用户提供的上下文，用中文给出清晰、可执行的分析与答案。'

export type VisionRequest = {
  images: string[]
  prompt: string
  systemPrompt?: string
}

export interface VisionProvider {
  analyze(request: VisionRequest): Promise<string>
}

type ChatCompletionContent = string | Array<{ type?: string; text?: string }>
type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: ChatCompletionContent } }>
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

export function createVisionProviderFromEnv(): VisionProvider | undefined {
  const apiKey = process.env.SILICONFLOW_API_KEY?.trim()
  if (!apiKey) return undefined

  const baseUrl = (
    process.env.SILICONFLOW_BASE_URL?.trim() || 'https://api.siliconflow.cn/v1'
  ).replace(/\/$/, '')
  const model =
    process.env.SILICONFLOW_VISION_MODEL?.trim() || 'Qwen/Qwen3-VL-32B-Instruct'
  const configuredDetail = process.env.SILICONFLOW_IMAGE_DETAIL?.trim()
  const imageDetail =
    configuredDetail === 'low' || configuredDetail === 'auto' ? configuredDetail : 'high'
  const timeoutMs = Math.max(
    5_000,
    Number(process.env.SILICONFLOW_VISION_TIMEOUT_MS) || 45_000
  )

  return {
    async analyze({ images, prompt, systemPrompt }) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT
              },
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
            ],
            temperature: 0.2,
            max_tokens: 2_000
          }),
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
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('视觉模型响应超时')
        }
        throw error
      } finally {
        clearTimeout(timeout)
      }
    }
  }
}
