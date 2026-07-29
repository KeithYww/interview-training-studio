import { Link } from 'react-router'
import { ArrowLeft, FolderOpen, Keyboard, Palette, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/lib/store/settings'
import { CustomShortcuts, ResetDefaultShortcuts } from './CustomShortcuts'
import { AccountStatusButton } from '@/account/AccountStatusButton'
import { SceneManagerCard } from '@/components/SceneManager'
import { AudioSourceSettings } from './AudioSourceSettings'

export default function SettingsPage() {
  const { opacity, screenshotAutoSave, hideDockIcon, updateSetting } = useSettingsStore()
  return (
    <>
      <div id="app-header" className="flex items-center">
        <div className="actions">
          <Button variant="ghost" asChild size="icon" className="w-12 mr-2 rounded-none">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        </div>
        <h1>设置</h1>
        <div className="actions ml-auto">
          <AccountStatusButton />
        </div>
      </div>
      <div id="app-content" className="flex flex-col gap-4 p-8">
        <section className="offerget-glass-card p-6">
          <h2 className="mb-2 flex items-center text-lg font-semibold">
            <Shield className="mr-2 h-5 w-5 text-indigo-300" />
            服务与隐私
          </h2>
          <p className="text-sm text-slate-400">
            offerGet 的模型与语音服务由服务器安全托管。客户端不会保存模型、语音或支付密钥。
          </p>
        </section>
        <SceneManagerCard />
        <AudioSourceSettings />
        <section className="offerget-glass-card p-6">
          <h2 className="mb-4 flex items-center text-lg font-semibold">
            <Palette className="mr-2 h-5 w-5 text-indigo-300" />
            外观
          </h2>
          <div className="flex items-center justify-between gap-6">
            <label className="text-sm font-medium">窗口不透明度</label>
            <Slider
              className="w-60"
              value={[opacity]}
              min={0.5}
              max={1}
              step={0.05}
              onValueChange={([value]) => updateSetting('opacity', value)}
            />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">在 Dock 中显示应用图标</label>
              <p className="mt-1 text-xs text-slate-500">
                面试进行中会自动隐藏，结束后恢复此设置。
              </p>
            </div>
            <Switch
              checked={!hideDockIcon}
              onCheckedChange={(checked) => updateSetting('hideDockIcon', !checked)}
            />
          </div>
        </section>
        <section className="offerget-glass-card p-6">
          <h2 className="mb-4 flex items-center text-lg font-semibold">
            <FolderOpen className="mr-2 h-5 w-5 text-indigo-300" />
            截图
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">自动保存截图</div>
              <p className="text-xs text-slate-500">仅在你的设备上保存练习截图</p>
            </div>
            <Switch
              checked={screenshotAutoSave}
              onCheckedChange={(checked) => updateSetting('screenshotAutoSave', checked)}
            />
          </div>
        </section>
        <section className="offerget-glass-card p-6">
          <h2 className="mb-4 flex items-center text-lg font-semibold">
            <Keyboard className="mr-2 h-5 w-5 text-indigo-300" />
            快捷键
          </h2>
          <CustomShortcuts />
          <ResetDefaultShortcuts />
        </section>
      </div>
    </>
  )
}
