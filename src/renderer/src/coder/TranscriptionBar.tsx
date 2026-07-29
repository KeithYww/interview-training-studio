import { useEffect, useRef } from 'react'
import { Mic } from 'lucide-react'
import { useTranscriptionStore } from '@/lib/store/transcription'

export function TranscriptionBar() {
  const { isTranscribing, transcriptionText } = useTranscriptionStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [transcriptionText])

  if (!isTranscribing && !transcriptionText) return null

  return (
    <div className="relative z-20 my-3">
      <div className="flex items-start gap-2 rounded-xl border border-indigo-300/15 bg-slate-950/80 py-2.5 pl-3 pr-2 shadow-lg shadow-black/25 backdrop-blur-xl">
        {isTranscribing && (
          <Mic className="w-4 h-4 mt-0.5 text-green-400 flex-shrink-0 animate-pulse" />
        )}
        <div
          ref={scrollRef}
          className="transcription-scroll max-h-[4.2em] flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-[1.4em] text-slate-200"
        >
          {transcriptionText || (isTranscribing ? '等待语音输入...' : '')}
        </div>
      </div>
    </div>
  )
}
