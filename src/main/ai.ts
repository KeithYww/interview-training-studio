import type { ModelMessage } from './model-message'
import { offergetApi } from './offerget-api'
import { settings } from './settings'

function inputFrom(messages: ModelMessage[]) {
  const images: string[] = []
  const prompts: string[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') prompts.push(message.content)
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text' && 'text' in part && typeof part.text === 'string')
          prompts.push(part.text)
        if (part.type === 'image' && 'image' in part && typeof part.image === 'string')
          images.push(part.image)
      }
    }
  }
  if (images.length === 0) throw new Error('未找到截图')
  return { images: images.slice(-5), prompt: prompts.join('\n\n').slice(-20_000) }
}

async function* serverSolution(messages: ModelMessage[], abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) return
  const session = await offergetApi.activeSession()
  const { images, prompt } = inputFrom(messages)
  const answerStream = offergetApi.screenshotStream(
    session.id,
    images,
    prompt,
    settings.customPrompt,
    undefined,
    abortSignal
  )
  for await (const chunk of answerStream) {
    if (abortSignal?.aborted) return
    yield chunk
  }
}

export function getSolutionStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return serverSolution(messages, abortSignal)
}

export function getFollowUpStream(messages: ModelMessage[], _userQuestion: string, abortSignal?: AbortSignal) {
  return serverSolution(messages, abortSignal)
}

export function getGeneralStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return serverSolution(messages, abortSignal)
}
