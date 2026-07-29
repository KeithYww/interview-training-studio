import type { ModelMessage } from './model-message'
import { offergetApi, type ScreenshotConversationMessage } from './offerget-api'
import { settings } from './settings'
import { buildVoiceSystemPrompt } from './voice-prompt'

function inputFrom(messages: ModelMessage[]) {
  const images: string[] = []
  const prompts: string[] = []
  const conversation: ScreenshotConversationMessage[] = []
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (typeof message.content === 'string') {
      prompts.push(message.content)
      conversation.push({ role: message.role, text: message.content })
      continue
    }
    if (Array.isArray(message.content)) {
      const messageImages: string[] = []
      const messageTexts: string[] = []
      for (const part of message.content) {
        if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
          prompts.push(part.text)
          messageTexts.push(part.text)
        }
        if (part.type === 'image' && 'image' in part && typeof part.image === 'string') {
          images.push(part.image)
          messageImages.push(part.image)
        }
      }
      conversation.push({
        role: message.role,
        text: messageTexts.join('\n\n'),
        ...(messageImages.length > 0 ? { images: messageImages } : {})
      })
    }
  }
  if (images.length === 0) throw new Error('未找到截图')
  let remainingImages = 5
  let remainingText = 20_000
  const retainedConversation: ScreenshotConversationMessage[] = []
  for (
    let index = conversation.length - 1;
    index >= 0 && retainedConversation.length < 12;
    index -= 1
  ) {
    const message = conversation[index]
    const messageImages =
      remainingImages > 0 && message.images?.length
        ? message.images.slice(-remainingImages)
        : undefined
    remainingImages -= messageImages?.length ?? 0
    const text =
      remainingText > 0 ? message.text.slice(Math.max(0, message.text.length - remainingText)) : ''
    remainingText -= text.length
    if (!text.trim() && !messageImages?.length) continue
    retainedConversation.push({
      role: message.role,
      text,
      ...(messageImages?.length ? { images: messageImages } : {})
    })
  }
  retainedConversation.reverse()
  return {
    images: images.slice(-5),
    prompt: prompts.join('\n\n').slice(-20_000),
    conversation: retainedConversation
  }
}

async function* serverSolution(messages: ModelMessage[], abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) return
  const session = await offergetApi.activeSession()
  const { images, prompt, conversation } = inputFrom(messages)
  const systemPrompt = [
    settings.customPrompt,
    images.length > 1
      ? '这是连续截图对话。请按消息顺序理解每张截图，优先识别并回答最后一条用户消息中的最新截图；仅在必要时结合之前截图。'
      : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  const answerStream = offergetApi.screenshotStream(
    session.id,
    images,
    prompt,
    systemPrompt,
    undefined,
    abortSignal,
    conversation
  )
  for await (const chunk of answerStream) {
    if (abortSignal?.aborted) return
    yield chunk
  }
}

export function getSolutionStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return serverSolution(messages, abortSignal)
}

export function getFollowUpStream(
  messages: ModelMessage[],
  _userQuestion: string,
  abortSignal?: AbortSignal
) {
  return serverSolution(messages, abortSignal)
}

export function getGeneralStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return serverSolution(messages, abortSignal)
}

function textConversationContext(messages: ModelMessage[]): string {
  return messages
    .slice(-8)
    .map((message) => {
      const text =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((part) => part.type === 'text' && 'text' in part)
              .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
              .join('\n')
      if (!text.trim()) return ''
      return `${message.role === 'assistant' ? '助手' : '面试官'}：${text.trim()}`
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(-12_000)
}

export async function* getVoiceAnswerStream(
  messages: ModelMessage[],
  question: string,
  abortSignal?: AbortSignal
) {
  if (abortSignal?.aborted) return
  const session = await offergetApi.activeSession()
  const context = textConversationContext(messages)
  const prompt = [
    context ? `本场面试最近的对话上下文：\n${context}` : '',
    `刚刚收到的原始语音转写片段：\n${question.trim()}`,
    '请结合上下文提炼这一次的完整问题并作答。'
  ]
    .filter(Boolean)
    .join('\n\n')
  const answerStream = offergetApi.answerStream(
    session.id,
    prompt,
    buildVoiceSystemPrompt(settings.customPrompt),
    undefined,
    abortSignal
  )
  for await (const chunk of answerStream) {
    if (abortSignal?.aborted) return
    yield chunk
  }
}
