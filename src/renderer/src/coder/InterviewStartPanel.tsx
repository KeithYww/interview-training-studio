import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, LogIn, Mic, MicOff, Play, RefreshCw, StopCircle, WalletCards } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranscriptionStore } from '@/lib/store/transcription'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

type Entitlements = {
  user?: { email: string }
  trial?: {
    screenshot?: { used: boolean; durationMinutes: number }
    voice?: { remaining: number; durationMinutes: number }
  }
  passes?: { available?: number; paid?: number; activation?: number }
  activeSession?: {
    id: string
    expiresAt: string
    voiceExpiresAt?: string
    kind?: 'trial' | 'paid' | 'activation'
  } | null
  features?: { voiceRecognition?: boolean; screenshotRecognition?: boolean }
}

type ApiResult = {
  ok: boolean
  code?: string
  message?: string
  data?: Entitlements
}

const openAccount = () => window.dispatchEvent(new Event('offerget:open-account'))

export function InterviewStartPanel() {
  const { isTranscribing } = useTranscriptionStore()
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [endConfirmOpen, setEndConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = (await window.api.getEntitlements()) as ApiResult
    if (result.ok && result.data) {
      setEntitlements(result.data)
      setLoadError('')
      window.dispatchEvent(
        new CustomEvent('offerget:entitlements-updated', { detail: result.data })
      )
    } else if (result.code === 'AUTH_REQUIRED') {
      setEntitlements(null)
      setLoadError('')
      window.dispatchEvent(new CustomEvent('offerget:entitlements-updated', { detail: null }))
    } else {
      setLoadError(result.message || '暂时无法读取账户权益')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const handleAuthChanged = () => void refresh()
    const handleEntitlementsChanged = () => void refresh()
    window.addEventListener('offerget:auth-changed', handleAuthChanged)
    window.addEventListener('offerget:entitlements-changed', handleEntitlementsChanged)
    return () => {
      window.removeEventListener('offerget:auth-changed', handleAuthChanged)
      window.removeEventListener('offerget:entitlements-changed', handleEntitlementsChanged)
    }
  }, [refresh])

  const active = entitlements?.activeSession
  const remaining = useMemo(
    () => (active ? Math.max(0, new Date(active.expiresAt).getTime() - now) : 0),
    [active, now]
  )
  const remainingLabel = `${Math.floor(remaining / 60000)}:${String(
    Math.floor(remaining / 1000) % 60
  ).padStart(2, '0')}`
  const activationVoiceExpired =
    active?.kind === 'activation' &&
    Boolean(active.voiceExpiresAt) &&
    new Date(active.voiceExpiresAt!).getTime() <= now

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      setNow(Date.now())
      if (new Date(active.expiresAt).getTime() <= Date.now()) void refresh()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  const startInterview = async () => {
    setConfirmOpen(false)
    setBusy(true)
    setNotice('')
    const result = (await window.api.startPracticeSession()) as ApiResult
    setBusy(false)
    if (result.ok) {
      await window.api.clearInterviewWorkspace()
      setNotice('面试已开始，截图识别已解锁')
      await refresh()
      return
    }
    setNotice(result.message || '暂时无法开始面试')
    if (result.code === 'AUTH_REQUIRED' || result.code === 'NO_ENTITLEMENT') openAccount()
  }

  const endInterview = async () => {
    if (!active?.id) return
    setEndConfirmOpen(false)
    setBusy(true)
    const result = (await window.api.stopPracticeSession(active.id)) as ApiResult
    setBusy(false)
    if (result.ok) {
      await window.api.clearInterviewWorkspace()
      setNotice('本场面试已结束')
      await refresh()
      return
    }
    setNotice(result.message || '暂时无法结束面试')
  }

  if (!entitlements && loading) {
    return (
      <section className="offerget-interview-panel">
        <div>
          <div className="offerget-interview-eyebrow">面试工作台</div>
          <h2>正在读取账户权益</h2>
          <p>正在同步登录状态和可用面试次数，请稍候。</p>
        </div>
        <Button className="offerget-primary-action" disabled>
          <RefreshCw className="size-4 animate-spin" />
          正在加载
        </Button>
      </section>
    )
  }

  if (!entitlements && loadError) {
    return (
      <section className="offerget-interview-panel">
        <div>
          <div className="offerget-interview-eyebrow">权益同步失败</div>
          <h2>登录状态仍会保留</h2>
          <p>{loadError}，请重试，不需要重新登录。</p>
        </div>
        <Button
          className="offerget-primary-action"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          重新加载
        </Button>
      </section>
    )
  }

  if (!entitlements?.user) {
    return (
      <section className="offerget-interview-panel">
        <div>
          <div className="offerget-interview-eyebrow">面试工作台</div>
          <h2>开始面试</h2>
          <p>使用 QQ 邮箱登录后，可领取 45 分钟免费体验并保存使用权益。</p>
        </div>
        <Button
          data-testid="login-to-interview"
          className="offerget-primary-action"
          onClick={openAccount}
        >
          <LogIn className="size-4" />
          QQ 邮箱登录
        </Button>
      </section>
    )
  }

  if (active && remaining > 0) {
    return (
      <section className="offerget-interview-panel is-active">
        <div>
          <div className="offerget-interview-eyebrow">
            面试进行中 ·{' '}
            {active.kind === 'trial'
              ? '免费体验'
              : active.kind === 'activation'
                ? '体验码'
                : '次卡'}
          </div>
          <h2 className="flex items-center gap-2">
            <Clock3 className="size-5 text-indigo-300" />
            剩余 {remainingLabel}
          </h2>
          <p>
            {entitlements.features?.screenshotRecognition
              ? '现在可以使用截图识别；计时结束后会自动锁定。'
              : '截图模型尚未配置，面试计时可用，但截图识别暂不可用。'}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            data-testid="toggle-transcription"
            variant="outline"
            className={
              isTranscribing
                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15 hover:text-emerald-200'
                : 'border-white/15 bg-white/5 text-slate-100 hover:border-indigo-400/50 hover:bg-indigo-400/10 hover:text-white'
            }
            disabled={busy || !entitlements.features?.voiceRecognition || activationVoiceExpired}
            onClick={(event) => {
              event.stopPropagation()
              window.dispatchEvent(new Event('offerget:toggle-transcription'))
            }}
          >
            {isTranscribing ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            {!entitlements.features?.voiceRecognition
              ? '语音服务待配置'
              : activationVoiceExpired
                ? '语音权益已结束'
                : isTranscribing
                  ? '停止语音作答'
                  : active.kind === 'paid'
                    ? '开启语音自动作答'
                    : active.kind === 'activation'
                      ? '开启语音自动作答 · 45 分钟'
                      : `语音自动作答 · 剩余 ${entitlements.trial?.voice?.remaining ?? 0} 次`}
          </Button>
          <Button
            type="button"
            data-testid="end-interview"
            variant="outline"
            className="border-rose-400/35 bg-rose-400/10 text-rose-300 hover:border-rose-300/60 hover:bg-rose-400/20 hover:text-rose-200"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation()
              setEndConfirmOpen(true)
            }}
          >
            <StopCircle className="size-4" />
            结束面试
          </Button>
        </div>
        <Dialog open={endConfirmOpen} onOpenChange={setEndConfirmOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>确认结束本场面试？</DialogTitle>
              <DialogDescription>
                结束后将立即停止计时并锁定截图识别。已使用的免费体验、体验码权益或次卡不会退回。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEndConfirmOpen(false)}>
                继续面试
              </Button>
              <Button
                type="button"
                data-testid="confirm-end-interview"
                variant="destructive"
                disabled={busy}
                onClick={() => void endInterview()}
              >
                确认结束
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    )
  }

  const trialAvailable = !entitlements.trial?.screenshot?.used
  const passes = entitlements.passes?.available ?? 0
  const activationPasses = entitlements.passes?.activation ?? 0
  const nextIsActivation = !trialAvailable && activationPasses > 0

  if (!trialAvailable && passes === 0) {
    return (
      <section className="offerget-interview-panel">
        <div>
          <div className="offerget-interview-eyebrow">暂无可用次数</div>
          <h2>购买次数后继续使用</h2>
          <p>每场 60 分钟，支付到账后仍由你主动开始，不会自动扣次。</p>
        </div>
        <Button
          data-testid="buy-interviews"
          className="offerget-primary-action"
          onClick={openAccount}
        >
          <WalletCards className="size-4" />
          购买面试次数
        </Button>
      </section>
    )
  }

  return (
    <>
      <section className="offerget-interview-panel">
        <div>
          <div className="offerget-interview-eyebrow">
            {trialAvailable
              ? '免费体验可用'
              : nextIsActivation
                ? `体验码权益 ${activationPasses} 次`
                : `可用次数 ${passes} 次`}
          </div>
          <h2>
            {trialAvailable
              ? '首次面试免费使用 45 分钟'
              : nextIsActivation
                ? '体验码面试：截图 60 分钟'
                : '开始一场 60 分钟模拟面试'}
          </h2>
          <p className="flex items-center gap-1.5">
            <WalletCards className="size-4" />
            {trialAvailable
              ? '开始后立即计时，可使用截图识别，不会扣除次卡。'
              : nextIsActivation
                ? '本场将使用 1 次体验码权益，语音识别可使用前 45 分钟。'
                : '本场将使用 1 次次卡，开始后不可暂停。'}
          </p>
          {notice && <p className="mt-2 text-orange-700">{notice}</p>}
        </div>
        <Button
          data-testid="start-interview"
          className="offerget-primary-action"
          disabled={busy}
          onClick={() => (trialAvailable ? void startInterview() : setConfirmOpen(true))}
        >
          <Play className="size-4" />
          {busy ? '正在启动…' : trialAvailable ? '免费开始面试' : '开始面试'}
        </Button>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认开始本场面试？</DialogTitle>
            <DialogDescription>
              {nextIsActivation
                ? '将使用 1 次体验码权益：截图识别 60 分钟，语音识别前 45 分钟。开始后不可暂停，提前结束不退回。'
                : '将使用 1 次次卡，立即开始 60 分钟计时。开始后不可暂停，提前结束不退回次数。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              data-testid="confirm-paid-interview"
              className="bg-orange-500 hover:bg-orange-400"
              disabled={busy}
              onClick={() => void startInterview()}
            >
              {nextIsActivation ? '使用体验码权益并开始' : '使用 1 次并开始'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
