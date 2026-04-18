import { create } from 'zustand'
import {
  CheckUpdate,
  DownloadUpdate,
  InstallAndRestart,
  OpenDownloadsFolder,
  QuitForUpdate,
} from '../../wailsjs/go/main/App'
import { EventsOff, EventsOn } from '../../wailsjs/runtime/runtime'
import type { updater } from '../../wailsjs/go/models'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'error'
  | 'downloading'
  | 'downloaded'
  | 'download-error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string | null
  latestVersion: string | null
  manifest: updater.Manifest | null
  downloadedPath: string | null
  lastCheckedAt: Date | null
  errorMessage: string | null
  progressPercent: number
  progressLoaded: number
  progressTotal: number

  check: (opts?: { silent?: boolean }) => Promise<void>
  download: () => Promise<void>
  installAndRestart: () => Promise<void>
  openDownloadsFolder: () => Promise<void>
  quitForUpdate: () => Promise<void>
}

let progressListenerBound = false
function bindProgressListener(
  set: (fn: (s: UpdateState) => Partial<UpdateState>) => void,
) {
  if (progressListenerBound) return
  progressListenerBound = true
  EventsOn('update:download-progress', (payload: { loaded: number; total: number; percent: number }) => {
    set((s) => ({
      ...s,
      progressPercent: payload?.percent ?? 0,
      progressLoaded: payload?.loaded ?? 0,
      progressTotal: payload?.total ?? 0,
    }))
  })
}

export const useUpdaterStore = create<UpdateState>((set, get) => {
  bindProgressListener(set as never)
  return {
    status: 'idle',
    currentVersion: null,
    latestVersion: null,
    manifest: null,
    downloadedPath: null,
    lastCheckedAt: null,
    errorMessage: null,
    progressPercent: 0,
    progressLoaded: 0,
    progressTotal: 0,

    check: async ({ silent = false } = {}) => {
      if (!silent) set((s) => ({ ...s, status: 'checking', errorMessage: null }))
      try {
        const r = await CheckUpdate()
        set((s) => ({
          ...s,
          status: r.has_update ? 'available' : 'latest',
          currentVersion: r.current_version,
          latestVersion: r.latest_version,
          manifest: r.manifest ?? null,
          lastCheckedAt: new Date(r.checked_at),
          errorMessage: null,
        }))
      } catch (err) {
        set((s) => ({
          ...s,
          status: 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
        }))
      }
    },

    download: async () => {
      const m = get().manifest
      if (!m) return
      set((s) => ({
        ...s,
        status: 'downloading',
        progressPercent: 0,
        progressLoaded: 0,
        progressTotal: m.size_bytes ?? 0,
        errorMessage: null,
      }))
      try {
        const r = await DownloadUpdate(m)
        set((s) => ({
          ...s,
          status: 'downloaded',
          downloadedPath: r.local_path,
          progressPercent: 100,
        }))
      } catch (err) {
        set((s) => ({
          ...s,
          status: 'download-error',
          errorMessage: err instanceof Error ? err.message : String(err),
        }))
      }
    },

    installAndRestart: async () => {
      const path = get().downloadedPath
      if (!path) return
      await InstallAndRestart(path)
      // 不用再 Quit —— 后端已经 500ms 后自关
    },

    openDownloadsFolder: async () => {
      await OpenDownloadsFolder()
    },

    quitForUpdate: async () => {
      await QuitForUpdate()
    },
  }
})

// 生命周期:热更新时清理事件订阅(保险)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    EventsOff('update:download-progress')
    progressListenerBound = false
  })
}
