import { useSettingsStore } from '@/lib/store/settings'

let mediaStream: MediaStream | null = null
let audioContext: AudioContext | null = null
let processor: ScriptProcessorNode | null = null
let deliveryEnabled = false
let pendingAudio: ArrayBuffer[] = []
let pendingAudioBytes = 0
const MAX_PENDING_AUDIO_BYTES = 96 * 1024

function downsampleAndSend(float32: Float32Array): void {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const chunk = int16.buffer
  if (deliveryEnabled) {
    window.api.sendTranscriptionAudioChunk(chunk)
    return
  }
  pendingAudio.push(chunk)
  pendingAudioBytes += chunk.byteLength
  while (pendingAudioBytes > MAX_PENDING_AUDIO_BYTES && pendingAudio.length > 1) {
    pendingAudioBytes -= pendingAudio.shift()!.byteLength
  }
}

async function openSystemAudioStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true
  })
  stream.getVideoTracks().forEach((t) => t.stop())
  return stream
}

async function openMicrophoneStream(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: deviceId } },
    video: false
  })
}

export async function startAudioCapture(): Promise<void> {
  deliveryEnabled = false
  pendingAudio = []
  pendingAudioBytes = 0
  const { audioInputDeviceId, audioOutputDeviceId } = useSettingsStore.getState()
  let stream: MediaStream
  if (audioInputDeviceId) {
    try {
      stream = await openMicrophoneStream(audioInputDeviceId)
    } catch (error) {
      console.warn('Failed to open selected microphone, falling back to system audio:', error)
      stream = await openSystemAudioStream()
    }
  } else {
    stream = await openSystemAudioStream()
  }
  mediaStream = stream

  audioContext = new AudioContext({ sampleRate: 16000 })

  if (audioOutputDeviceId && 'setSinkId' in audioContext) {
    try {
      await (audioContext as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(
        audioOutputDeviceId
      )
    } catch (error) {
      console.warn('Failed to set audio output device:', error)
    }
  }

  const source = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))

  processor = audioContext.createScriptProcessor(2048, 1, 1)
  processor.onaudioprocess = (e) => {
    downsampleAndSend(e.inputBuffer.getChannelData(0))
  }
  source.connect(processor)
  processor.connect(audioContext.destination)
}

export function startAudioDelivery(): void {
  deliveryEnabled = true
  for (const chunk of pendingAudio) window.api.sendTranscriptionAudioChunk(chunk)
  pendingAudio = []
  pendingAudioBytes = 0
}

export function stopAudioCapture(): void {
  deliveryEnabled = false
  pendingAudio = []
  pendingAudioBytes = 0
  if (processor) {
    processor.disconnect()
    processor = null
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
