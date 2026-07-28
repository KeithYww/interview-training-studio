import { useEffect, useState } from 'react'
import { CreditCard, LogIn, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

type Entitlements = {
  user?: { email: string }
  trial?: { screenshot?: { used: boolean; durationMinutes: number }; voice?: { remaining: number; durationMinutes: number } }
  passes?: { available?: number }
  activeSession?: { id: string; expiresAt: string; kind?: string } | null
  features?: { voiceRecognition?: boolean; screenshotRecognition?: boolean }
}
type ApiResult = { ok: boolean; message?: string; data?: Entitlements; user?: { email: string }; session?: Entitlements['activeSession']; order?: { orderNo: string } }

const messageOf = (result: ApiResult, fallback: string) => result.message || fallback

export function AccountDialog({ open, onOpenChange, onAuthenticated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAuthenticated?: () => void
}) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [orderNo, setOrderNo] = useState<string | null>(null)

  const refresh = async () => {
    const result = await window.api.getEntitlements() as ApiResult
    if (result.ok && result.data) setEntitlements(result.data)
    else if (result.message && result.message !== '请先登录后再使用完整练习功能') setNotice(result.message)
  }
  useEffect(() => { if (open) void refresh() }, [open])

  const sendCode = async () => {
    if (!/^[^\s@]+@qq\.com$/i.test(email.trim())) { setNotice('仅支持 QQ 邮箱（@qq.com）'); return }
    setBusy(true); setNotice('')
    const result = await window.api.sendEmailCode(email.trim()) as ApiResult & { devCode?: string }
    setBusy(false)
    if (result.ok) { setCodeSent(true); setNotice(result.devCode ? `开发验证码：${result.devCode}` : '验证码已发送，请查收 QQ 邮箱') }
    else setNotice(messageOf(result, '验证码发送失败'))
  }
  const verify = async () => {
    setBusy(true); setNotice('')
    const result = await window.api.verifyEmailCode(email.trim(), code.trim()) as ApiResult
    setBusy(false)
    if (result.ok) {
      setCode('')
      setNotice('登录成功')
      await refresh()
      onAuthenticated?.()
      window.dispatchEvent(new Event('offerget:auth-changed'))
      onOpenChange(false)
    }
    else setNotice(messageOf(result, '验证码无效或已过期'))
  }
  const checkout = async (productCode: 'single_session' | 'ten_session') => {
    setBusy(true); setNotice('')
    const result = await window.api.createCheckout(productCode) as ApiResult
    setBusy(false)
    if (result.ok && result.order?.orderNo) { setOrderNo(result.order.orderNo); setNotice('订单已创建。开发环境可使用“模拟支付成功”完成联调。') }
    else setNotice(messageOf(result, '创建订单失败'))
  }
  const payMock = async () => {
    if (!orderNo) return
    setBusy(true)
    const result = await window.api.markOrderPaid(orderNo) as ApiResult
    setBusy(false)
    if (result.ok) {
      setNotice('支付已确认，面试次数已到账')
      setOrderNo(null)
      await refresh()
      window.dispatchEvent(new Event('offerget:entitlements-changed'))
    }
    else setNotice(messageOf(result, '支付确认失败'))
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-md border-white/10 bg-slate-950 text-slate-100">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-orange-400" />账户与练习权益</DialogTitle><DialogDescription>登录后由服务端统一管理试用、次卡和模型调用。</DialogDescription></DialogHeader>
      {!entitlements?.user ? <div className="space-y-3">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="请输入 QQ 邮箱" className="border-white/10 bg-white/5" />
        {codeSent && <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 位验证码" className="border-white/10 bg-white/5" />}
        <div className="flex gap-2"><Button variant="outline" className="flex-1 border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white" disabled={busy} onClick={sendCode}>发送验证码</Button>{codeSent && <Button className="flex-1 bg-orange-400 text-slate-950 hover:bg-orange-300" disabled={busy || code.length !== 6} onClick={verify}><LogIn />登录</Button>}</div>
      </div> : <div className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm"><div className="text-slate-400">已登录</div><div className="mt-1 font-medium">{entitlements.user.email}</div></div>
        <div className="grid grid-cols-2 gap-2 text-sm"><div className="rounded-lg bg-white/5 p-3"><div className="text-slate-400">免费面试体验</div><div className="mt-1">{entitlements.trial?.screenshot?.used ? '已使用' : '1 次 · 45 分钟'}</div></div><div className="rounded-lg bg-white/5 p-3"><div className="text-slate-400">免费语音识别</div><div className="mt-1">{entitlements.features?.voiceRecognition ? `剩余 ${entitlements.trial?.voice?.remaining ?? 0} 次 · 每次 15 分钟` : '服务器待配置'}</div></div></div>
        <div className="rounded-xl border border-white/10 p-3"><div className="mb-2 flex items-center gap-2 font-medium"><CreditCard className="size-4 text-orange-400" />可用面试次数 {entitlements.passes?.available ?? 0} 次</div><div className="flex gap-2"><Button variant="outline" className="h-12 flex-1 border-slate-600 bg-slate-900 text-sm font-semibold text-white shadow-sm hover:border-slate-500 hover:bg-slate-800 hover:text-white" disabled={busy} onClick={() => checkout('single_session')}><span>1 次面试</span><span className="text-orange-300">¥9.9</span></Button><Button className="h-12 flex-1 bg-orange-400 text-sm font-bold text-slate-950 shadow-md shadow-orange-950/30 hover:bg-orange-300" disabled={busy} onClick={() => checkout('ten_session')}><span>10 次面试</span><span>¥88</span></Button></div><p className="mt-2 text-xs text-slate-500">购买成功后不会自动开始面试。</p></div>
        {orderNo && <div className="rounded-xl border border-dashed border-orange-400/40 p-3 text-sm"><div>订单 {orderNo}</div><Button size="sm" className="mt-2 bg-orange-500 hover:bg-orange-400" disabled={busy} onClick={payMock}>模拟支付成功</Button></div>}
        <Button variant="ghost" size="sm" className="w-full text-slate-400" onClick={() => void refresh()}><RefreshCw />刷新权益</Button>
      </div>}
      {notice && <p className="rounded-lg bg-white/5 p-2 text-xs text-slate-300">{notice}</p>}
    </DialogContent>
  </Dialog>
}
