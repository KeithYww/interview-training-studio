import { ipcMain } from 'electron'
import { setInterviewModeActive } from './settings'

ipcMain.handle('updateAppState', (_event, _state) => {
  Object.assign(state, _state)
  if (typeof _state.interviewActive === 'boolean') {
    setInterviewModeActive(_state.interviewActive)
  }
})

export const state = {
  inCoderPage: false,
  ignoreMouse: false,
  interviewActive: false
}

export type AppState = typeof state
