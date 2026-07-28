let mediaStream: MediaStream | null = null
let audioContext: AudioContext | null = null
let processor: ScriptProcessorNode | null = null
let silentGain: GainNode | null = null

function downsampleAndSend(float32: Float32Array, sourceRate: number): void {
  const ratio = sourceRate / 16000
  const length = ratio > 1 ? Math.max(1, Math.floor(float32.length / ratio)) : float32.length
  const int16 = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    const sourceIndex = ratio > 1 ? Math.min(float32.length - 1, Math.floor(i * ratio)) : i
    const s = Math.max(-1, Math.min(1, float32[sourceIndex]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  window.api.sendTranscriptionAudioChunk(int16.buffer)
}

async function openSystemAudioStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true
  })
  stream.getVideoTracks().forEach((t) => t.stop())
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('未获取到电脑声音，请在系统共享窗口中勾选“共享系统音频”后重试')
  }
  return stream
}

export async function startAudioCapture(): Promise<void> {
  const stream = await openSystemAudioStream()
  mediaStream = stream

  audioContext = new AudioContext({ sampleRate: 16000 })

  const source = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))

  // 1024 samples at 16 kHz is about 64 ms. This keeps streaming latency low
  // without creating excessive IPC/WebSocket overhead.
  processor = audioContext.createScriptProcessor(1024, 1, 1)
  processor.onaudioprocess = (e) => {
    downsampleAndSend(e.inputBuffer.getChannelData(0), e.inputBuffer.sampleRate)
  }
  silentGain = audioContext.createGain()
  silentGain.gain.value = 0
  source.connect(processor)
  processor.connect(silentGain)
  silentGain.connect(audioContext.destination)
}

export function stopAudioCapture(): void {
  if (processor) {
    processor.disconnect()
    processor = null
  }
  if (silentGain) {
    silentGain.disconnect()
    silentGain = null
  }
  if (audioContext) {
    audioContext.close()
    audioContext = null
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
}
