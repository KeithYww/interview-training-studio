import { CircleHelp, Settings2, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/lib/store/app'
import brandIcon from '@/assets/offerget-icon.png'
import { AccountStatusButton } from '@/account/AccountStatusButton'

export function AppHeader() {
  const navigate = useNavigate()
  const { ignoreMouse } = useAppStore()
  return (
    <div id="app-header" className="flex items-center text-white">
      <div className="offerget-brand">
        <div className="offerget-brand-mark">
          <img src={brandIcon} alt="offerGet" />
        </div>
        <div className="offerget-brand-copy">
          offer<span>Get</span>
        </div>
      </div>
      <div className={`offerget-header-actions ${ignoreMouse ? 'pointer-events-none' : ''}`}>
        <AccountStatusButton />
        <Button
          variant="ghost"
          size="icon"
          aria-label="打开设置"
          className="size-8 cursor-pointer rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
          onClick={() => navigate('/settings')}
        >
          <Settings2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="打开帮助中心"
          className="size-8 cursor-pointer rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
          onClick={() => navigate('/help')}
        >
          <CircleHelp className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭应用"
          className="size-8 cursor-pointer rounded-lg text-slate-300 hover:bg-red-500/15 hover:text-red-300"
          onClick={() => window.close()}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
