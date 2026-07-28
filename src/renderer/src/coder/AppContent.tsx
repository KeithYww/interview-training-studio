import { useEffect, useState } from 'react'
import { useShortcutsStore } from '@/lib/store/shortcuts'
import { useSolutionStore } from '@/lib/store/solution'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { Button } from '@/components/ui/button'
import { InterviewStartPanel } from './InterviewStartPanel'

const SCROLL_OFFSET = 120
type InterviewAccess = 'loading' | 'logged-out' | 'not-started' | 'active'

type EntitlementSnapshot = {
  user?: { email: string }
  activeSession?: { expiresAt: string } | null
}

export function AppContent() {
  const {
    screenshotData,
    solutionChunks,
    errorMessage,
    setScreenshotData,
    setIsLoading,
    addSolutionChunk,
    setErrorMessage,
    clearSolution
  } = useSolutionStore()

  const [recentScreenshots, setRecentScreenshots] = useState<string[]>([])
  const [interviewAccess, setInterviewAccess] = useState<InterviewAccess>('loading')

  useEffect(() => {
    const applyEntitlements = (data: EntitlementSnapshot | null | undefined) => {
      if (!data?.user) {
        setInterviewAccess('logged-out')
        return
      }
      const active =
        data.activeSession &&
        new Date(data.activeSession.expiresAt).getTime() > Date.now()
      setInterviewAccess(active ? 'active' : 'not-started')
    }
    const refreshAccess = async () => {
      const result = await window.api.getEntitlements()
      applyEntitlements(result.ok ? result.data : null)
    }
    const handleUpdated = (event: Event) => {
      applyEntitlements((event as CustomEvent<EntitlementSnapshot | null>).detail)
    }
    void refreshAccess()
    window.addEventListener('offerget:entitlements-updated', handleUpdated)
    window.addEventListener('offerget:auth-changed', refreshAccess)
    return () => {
      window.removeEventListener('offerget:entitlements-updated', handleUpdated)
      window.removeEventListener('offerget:auth-changed', refreshAccess)
    }
  }, [])

  useEffect(() => {
    // Listen for screenshot events (latest)
    window.api.onScreenshotTaken((data: string) => {
      setScreenshotData(data)
    })

    // Listen for screenshots-updated events (gallery)
    window.api.onScreenshotsUpdated((screenshots: string[]) => {
      setRecentScreenshots(screenshots)
    })

    // New session clear (pictures + answers)
    window.api.onSolutionClear(() => {
      clearSolution()
      setRecentScreenshots([])
      setScreenshotData(null)
      setErrorMessage(null)
    })

    // Listen for solution chunks
    window.api.onSolutionChunk((chunk: string) => {
      addSolutionChunk(chunk)
    })

    // AI loading
    window.api.onAiLoadingStart(() => {
      setIsLoading(true)
      setErrorMessage(null) // Clear error when new request starts
    })
    window.api.onAiLoadingEnd(() => {
      setIsLoading(false)
    })

    // Cleanup listeners on unmount
    return () => {
      window.api.removeScreenshotListener()
      window.api.removeScreenshotsUpdatedListener()
      window.api.removeSolutionChunkListener()
      window.api.removeAiLoadingStartListener()
      window.api.removeAiLoadingEndListener()
      window.api.removeSolutionClearListener()
    }
  }, [setScreenshotData, clearSolution, setIsLoading, addSolutionChunk, setErrorMessage])

  useEffect(() => {
    window.api.onSolutionComplete(() => {
      setIsLoading(false)
    })
    window.api.onSolutionStopped(() => {
      setIsLoading(false)
    })
    window.api.onSolutionError((message: string) => {
      setIsLoading(false)
      setErrorMessage(message)
    })
    return () => {
      window.api.removeSolutionCompleteListener()
      window.api.removeSolutionStoppedListener()
      window.api.removeSolutionErrorListener()
    }
  }, [setIsLoading, setErrorMessage])

  useEffect(() => {
    window.api.onScrollPageUp(() => {
      const container = document.getElementById('app-content')
      if (!container) return
      container.scrollTo({
        top: container.scrollTop - window.innerHeight + SCROLL_OFFSET,
        behavior: 'smooth'
      })
    })
    return () => {
      window.api.removeScrollPageUpListener()
    }
  }, [])

  useEffect(() => {
    window.api.onScrollPageDown(() => {
      const container = document.getElementById('app-content')
      if (!container) return
      container.scrollTo({
        top: container.scrollTop + window.innerHeight - SCROLL_OFFSET,
        behavior: 'smooth'
      })
    })
    return () => {
      window.api.removeScrollPageDownListener()
    }
  }, [])

  return (
    <div id="app-content" className="px-6 py-4">
      <InterviewStartPanel />

      {/* Error Banner */}
      {errorMessage && (
        <div className="mb-4 mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start gap-3">
          <svg
            className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-red-400 font-medium text-sm">暂时无法完成操作</p>
            <p className="text-red-300/80 text-sm mt-0.5 break-words">{errorMessage}</p>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400/80 hover:text-red-300 flex-shrink-0"
            title="关闭"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Screenshot Gallery */}
      {recentScreenshots.length > 0 ? (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
          {recentScreenshots.map((data, index) => (
            <img
              key={index}
              src={`data:image/png;base64,${data}`}
              alt={`Screenshot ${index + 1}`}
              className="w-40 h-auto flex-shrink-0 border border-gray-600 rounded-lg shadow-lg hover:shadow-xl transition-shadow"
              title={`第 ${index + 1} 张截图`}
            />
          ))}
        </div>
      ) : screenshotData ? (
        <div className="mb-4">
          <img
            src={`data:image/png;base64,${screenshotData}`}
            alt="Screenshot"
            className="w-40 h-auto border border-gray-600 rounded-lg shadow-lg"
          />
        </div>
      ) : (
        <ShortcutTip access={interviewAccess} />
      )}

      {/* Solution Display */}
      <MarkdownRenderer>{solutionChunks.join('')}</MarkdownRenderer>
    </div>
  )
}

function ShortcutTip({ access }: { access: InterviewAccess }) {
  const { shortcuts } = useShortcutsStore()
  const [shortcutFailed, setShortcutFailed] = useState(false)

  useEffect(() => {
    const applyStatus = (
      snapshot:
        | Record<string, { status?: string }>
        | null
        | undefined
    ) => {
      setShortcutFailed(snapshot?.takeScreenshot?.status === 'failed')
    }
    const handleStatus = (event: Event) => {
      applyStatus(
        (event as CustomEvent<Record<string, { status?: string }>>).detail
      )
    }
    void window.api.getShortcuts().then(applyStatus)
    window.addEventListener('offerget:shortcuts-status', handleStatus)
    return () => window.removeEventListener('offerget:shortcuts-status', handleStatus)
  }, [])

  if (access !== 'active') {
    return (
      <div className="flex min-h-56 items-center justify-center text-lg text-slate-400 select-none">
        {access === 'logged-out'
          ? '登录并开始面试后可使用截图识别'
          : access === 'loading'
            ? '正在检查面试状态…'
            : '开始面试后可使用截图识别'}
      </div>
    )
  }

  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-gray-400 select-none">
      <div className="text-xl">
        {shortcutFailed ? '当前快捷键注册失败' : '按下快捷键'}
        <ShortcutRenderer
          shortcut={shortcuts.takeScreenshot.key}
          className="mx-1 font-bold text-black"
        />
        {shortcutFailed ? '，可能已被其他应用占用' : '截图识题'}
      </div>
      <Button
        type="button"
        variant={shortcutFailed ? 'default' : 'outline'}
        onClick={() => void window.api.triggerShortcutAction('takeScreenshot')}
      >
        立即截屏
      </Button>
      {shortcutFailed && (
        <p className="text-sm text-orange-700">可在“设置 → 快捷键”中更换组合键</p>
      )}
    </div>
  )
}
