import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route } from 'react-router'
import { Toaster } from 'sonner'
import CoderPage from '@/coder'
import SettingsPage from '@/settings'
import HelpPage from '@/help'
import { useSettingsStore } from '@/lib/store/settings'
import { useShortcutsStore } from '@/lib/store/shortcuts'
import { AccountDialog } from '@/account/AccountDialog'

export default function App() {
  const [initialized, setInitialized] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const settingsStore = useSettingsStore()
  const { shortcuts } = useShortcutsStore()

  useEffect(() => {
    window.api.getAppSettings().then((settings) => {
      const blankFields = Object.keys(settings).filter(
        (key) => settings[key] && !settingsStore[key]
      )
      settingsStore.syncSettings(
        blankFields.reduce(
          (acc, key) => {
            acc[key] = settings[key]
            return acc
          },
          {} as Partial<typeof settingsStore>
        )
      )
      setInitialized(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const openAccount = () => setAccountOpen(true)
    window.addEventListener('offerget:open-account', openAccount)
    return () => window.removeEventListener('offerget:open-account', openAccount)
  }, [])

  useEffect(() => {
    if (initialized) {
      window.api.updateAppSettings({
        opacity: settingsStore.opacity,
        screenshotAutoSave: settingsStore.screenshotAutoSave,
        screenshotDir: settingsStore.screenshotDir,
        hideDockIcon: settingsStore.hideDockIcon,
        audioInputDeviceId: settingsStore.audioInputDeviceId,
        audioOutputDeviceId: settingsStore.audioOutputDeviceId,
        customPrompt: settingsStore.customPrompt
      })
    }
  }, [initialized, settingsStore])

  useEffect(() => {
    window.api.initShortcuts(shortcuts)
    window.api.getShortcuts().then((shortcutsStatus) => {
      console.log('Shortcuts registered:', shortcutsStatus)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <HashRouter>
        <Routes>
          <Route index element={<CoderPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="help" element={<HelpPage />} />
        </Routes>
      </HashRouter>

      <Toaster />
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </>
  )
}
