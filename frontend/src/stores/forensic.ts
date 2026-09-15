import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ForensicStatus {
  checked: boolean
  found: boolean
  path: string
  version: string
  error: string
}

interface ForensicState {
  /** 用户自定义 go-forensic 路径。空 = 使用系统 PATH */
  binaryPath: string
  /**
   * 是否启用 go-forensic 这个备选引擎。
   *
   * 默认不启用:两个平台的提取都已内置,绝大多数人没装过它 —— 让每个人先面对一个
   * 「内置 / go-forensic」的选择题没有意义。启用后取证页面才出现引擎选择。
   */
  cliEnabled: boolean
  /** 默认 SSH 地址（iOS 用） */
  defaultSshAddr: string
  /** 默认输出根目录，前端仅用于 UI 默认值 */
  defaultOutputBase: string
  /** 缓存最近一次检测结果，避免每次进工具页都重新 exec */
  checkCache: {
    /** 缓存针对的路径；与当前 binaryPath 不一致时视为失效 */
    forPath: string
    found: boolean
    resolvedPath: string
    version: string
    error: string
    at: number
  } | null
  /** 最近使用的命令（最多 10 条） */
  history: HistoryItem[]
  setBinaryPath: (p: string) => void
  setCliEnabled: (on: boolean) => void
  setDefaultSshAddr: (a: string) => void
  setDefaultOutputBase: (p: string) => void
  setCheckCache: (c: ForensicState['checkCache']) => void
  invalidateCheck: () => void
  pushHistory: (item: HistoryItem) => void
  clearHistory: () => void
}

export interface HistoryItem {
  at: number
  platform: 'android' | 'ios'
  args: string[]
  exitCode: number
  canceled?: boolean
}

export const useForensicStore = create<ForensicState>()(
  persist(
    (set) => ({
      binaryPath: '',
      cliEnabled: false,
      defaultSshAddr: 'root@127.0.0.1:22',
      defaultOutputBase: '',
      checkCache: null,
      history: [],
      setBinaryPath: (p) =>
        set((s) => ({
          binaryPath: p,
          // 路径变了，旧缓存失效
          checkCache:
            s.checkCache && s.checkCache.forPath === p ? s.checkCache : null,
        })),
      setCliEnabled: (on) => set({ cliEnabled: on }),
      setDefaultSshAddr: (a) => set({ defaultSshAddr: a }),
      setDefaultOutputBase: (p) => set({ defaultOutputBase: p }),
      setCheckCache: (c) => set({ checkCache: c }),
      invalidateCheck: () => set({ checkCache: null }),
      pushHistory: (item) =>
        set((s) => ({ history: [item, ...s.history].slice(0, 10) })),
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'tool-forge:forensic',
      version: 1,
      // 老用户迁移:cliEnabled 这个字段是后加的,老配置里没有,反序列化出来是 false。
      // 但配过路径的人显然一直在用 go-forensic —— 不迁的话他们升级后会发现
      // 引擎选择器凭空消失了,而"去哪儿把它找回来"完全没有线索
      migrate: (state, from) => {
        const s = state as Partial<ForensicState> | undefined
        if (from < 1 && s && typeof s.binaryPath === 'string' && s.binaryPath.trim() !== '') {
          return { ...s, cliEnabled: true } as ForensicState
        }
        return state as ForensicState
      },
    }
  )
)

/** 凭据库中 SSH 密码的 key 规则 */
export function sshPasswordKey(sshAddr: string): string {
  return `forensic:ssh:${sshAddr}`
}
