import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/store/app'
import { useTranscriptionStore } from '@/lib/store/transcription'
import { useSolutionStore } from '@/lib/store/solution'
import { startAudioCapture, stopAudioCapture } from '@/lib/audio-capture'

import { AppHeader } from './AppHeader'
import { AppContent } from './AppContent'
import { AppStatusBar } from './AppStatusBar'
import { TranscriptionBar } from './TranscriptionBar'

export default function CoderPage() {
  const [interviewActive, setInterviewActive] = useState(false)
  const previousInterviewActive = useRef<boolean | null>(null)
  const { syncAppState } = useAppStore()
  const { isTranscribing, setIsTranscribing, setTranscriptionText, clearText } =
    useTranscriptionStore()
  const { setErrorMessage } = useSolutionStore()

  useEffect(() => {
    window.api.updateAppState({ inCoderPage: true })
    return () => {
      window.api.updateAppState({ inCoderPage: false })
    }
  }, [])

  useEffect(() => {
    const applyEntitlements = (
      data:
        | { activeSession?: { expiresAt: string } | null }
        | null
        | undefined
    ) => {
      const active =
        data?.activeSession &&
        new Date(data.activeSession.expiresAt).getTime() > Date.now()
      const isActive = Boolean(active)
      setInterviewActive(isActive)
      void window.api.updateAppState({ interviewActive: isActive })
      if (
        data &&
        !isActive &&
        (previousInterviewActive.current === null || previousInterviewActive.current)
      ) {
        void window.api.clearInterviewWorkspace()
      }
      previousInterviewActive.current = isActive
      if (!isActive && useTranscriptionStore.getState().isTranscribing) {
        stopAudioCapture()
        void window.api.stopTranscription()
        useTranscriptionStore.getState().setIsTranscribing(false)
      }
    }
    const refresh = async () => {
      const result = await window.api.getEntitlements()
      applyEntitlements(result.ok ? result.data : null)
    }
    const handleUpdated = (event: Event) => {
      applyEntitlements(
        (event as CustomEvent<{ activeSession?: { expiresAt: string } | null }>).detail
      )
    }
    void refresh()
    window.addEventListener('offerget:entitlements-updated', handleUpdated)
    return () => window.removeEventListener('offerget:entitlements-updated', handleUpdated)
  }, [])

  useEffect(() => {
    window.api.onSyncAppState((state) => {
      syncAppState(state)
    })
    return () => {
      window.api.removeSyncAppStateListener()
    }
  }, [syncAppState])

  useEffect(() => {
    const handleToggle = async () => {
      if (isTranscribing) {
        stopAudioCapture()
        await window.api.stopTranscription()
        setIsTranscribing(false)
      } else {
        try {
          const entitlement = await window.api.getEntitlements()
          const sessionId = entitlement.data?.activeSession?.id
          if (!entitlement.ok || !sessionId) {
            throw new Error(entitlement.message || '请先在“练习权益”中启动练习会话')
          }
          await startAudioCapture()
          await window.api.startTranscription(sessionId)
          setIsTranscribing(true)
          setErrorMessage(null)
          window.dispatchEvent(new Event('offerget:entitlements-changed'))
        } catch (err) {
          console.error('Failed to start transcription:', err)
          stopAudioCapture()
          setErrorMessage(err instanceof Error ? err.message : '启动语音转录失败')
        }
      }
    }

    window.api.onToggleTranscription(handleToggle)
    window.addEventListener('offerget:toggle-transcription', handleToggle)
    return () => {
      window.api.removeToggleTranscriptionListener()
      window.removeEventListener('offerget:toggle-transcription', handleToggle)
    }
  }, [isTranscribing, setIsTranscribing, setErrorMessage])

  useEffect(() => {
    window.api.onTranscriptionText((data) => {
      setTranscriptionText(data.text)
    })
    window.api.onTranscriptionError((message) => {
      setErrorMessage(message)
      setIsTranscribing(false)
      stopAudioCapture()
    })
    window.api.onTranscriptionStopped(() => {
      setIsTranscribing(false)
    })
    window.api.onTranscriptionCleared(() => {
      clearText()
    })

    return () => {
      window.api.removeTranscriptionTextListener()
      window.api.removeTranscriptionErrorListener()
      window.api.removeTranscriptionStoppedListener()
      window.api.removeTranscriptionClearedListener()
    }
  }, [setTranscriptionText, setErrorMessage, setIsTranscribing, clearText])

  useEffect(() => {
    return () => {
      if (useTranscriptionStore.getState().isTranscribing) {
        stopAudioCapture()
        window.api.stopTranscription()
      }
    }
  }, [])

  return (
    <div className={`relative h-screen ${interviewActive ? 'interview-mode' : ''}`}>
      {interviewActive ? <div className="interview-drag-strip" aria-hidden="true" /> : <AppHeader />}
      <AppContent />
      <TranscriptionBar />
      <AppStatusBar />
    </div>
  )
}
