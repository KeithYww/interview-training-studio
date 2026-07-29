import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVoiceSystemPrompt } from '../../src/main/voice-prompt'

test('语音作答先提炼问题并保留当前场景要求', () => {
  const prompt = buildVoiceSystemPrompt('先解释思路，再输出 TypeScript 代码')

  assert.match(prompt, /提炼面试官真正提出的完整问题/)
  assert.match(prompt, /\*\*识别到的问题：\*\*/)
  assert.match(prompt, /\*\*参考回答：\*\*/)
  assert.match(prompt, /不要编造答案/)
  assert.match(prompt, /先解释思路，再输出 TypeScript 代码/)
  assert.match(prompt, /“截图”的描述.*“语音转写内容”/)
})
