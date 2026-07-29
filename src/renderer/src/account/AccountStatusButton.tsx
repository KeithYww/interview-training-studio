import { useCallback, useEffect, useState } from 'react'
import { Crown, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function AccountStatusButton() {
  const [email, setEmail] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await window.api.getEntitlements()
    if (result.ok && result.data?.user?.email) {
      setEmail(result.data.user.email)
    } else if (result.code === 'AUTH_REQUIRED') {
      setEmail(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    window.addEventListener('offerget:auth-changed', refresh)
    window.addEventListener('offerget:entitlements-changed', refresh)
    return () => {
      window.removeEventListener('offerget:auth-changed', refresh)
      window.removeEventListener('offerget:entitlements-changed', refresh)
    }
  }, [refresh])

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 max-w-52 cursor-pointer gap-1.5 rounded-lg text-indigo-200 hover:bg-indigo-400/10 hover:text-white"
      title={email ?? 'QQ 邮箱登录'}
      onClick={() => window.dispatchEvent(new Event('offerget:open-account'))}
    >
      {email ? <Crown className="size-4 shrink-0" /> : <LogIn className="size-4 shrink-0" />}
      <span className="truncate">{email ?? 'QQ 邮箱登录'}</span>
    </Button>
  )
}
