import { useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSettingsStore } from '@/lib/store/settings'

export function AudioSourceSettings() {
  const { audioInputDeviceId, updateSetting } = useSettingsStore()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    let cancelled = false
    const loadDevices = async () => {
      try {
        let available = await navigator.mediaDevices.enumerateDevices()
        if (available.every((device) => !device.label)) {
          const permissionStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
          })
          permissionStream.getTracks().forEach((track) => track.stop())
          available = await navigator.mediaDevices.enumerateDevices()
        }
        if (!cancelled) setDevices(available.filter((device) => device.kind === 'audioinput'))
      } catch (error) {
        console.warn('Unable to enumerate audio input devices:', error)
      }
    }
    void loadDevices()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="offerget-glass-card p-6">
      <h2 className="mb-2 flex items-center text-lg font-semibold">
        <Mic className="mr-2 size-5" />
        语音识别音源
      </h2>
      <p className="mb-4 text-sm text-slate-400">
        默认直接捕获电脑声音，不需要选择共享窗口；也可以选择麦克风或虚拟音频设备。
      </p>
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="text-sm font-medium">音频输入</div>
          <p className="mt-1 text-xs text-slate-500">
            选择的设备不可用时，会自动回退到默认麦克风。
          </p>
        </div>
        <Select
          value={audioInputDeviceId || 'system'}
          onValueChange={(value) =>
            updateSetting('audioInputDeviceId', value === 'system' ? '' : value)
          }
        >
          <SelectTrigger className="w-72 border-white/10 bg-white/5">
            <SelectValue placeholder="电脑声音（推荐）" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">电脑声音（推荐）</SelectItem>
            {devices.map((device) => (
              <SelectItem key={device.deviceId} value={device.deviceId}>
                {device.label || `音频设备 ${device.deviceId.slice(0, 6)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}
