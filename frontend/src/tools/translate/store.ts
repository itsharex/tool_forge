import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type DetectMethod = 'auto' | 'algorithm' | 'llm'

export interface TranslateSettings {
  sourceLang: string // 'auto' / 'zh' / 'en' / ...
  targetLang: string
  providerId: string
  modelId: string
  showMarkdown: boolean
  autoCopy: boolean
  scrollSync: boolean
  detectMethod: DetectMethod
  bidirectional: boolean
  prompt: string // 空 = 用后端默认
}

export interface TranslateHistoryItem {
  id: string
  ts: number
  source: string
  target: string
  sourceLangId: string
  targetLangId: string
  providerId: string
  providerName: string
  modelId: string
}

interface TranslateState extends TranslateSettings {
  history: TranslateHistoryItem[]
  setMany: (patch: Partial<TranslateSettings>) => void
  pushHistory: (item: Omit<TranslateHistoryItem, 'id' | 'ts'>) => void
  removeHistory: (id: string) => void
  clearHistory: () => void
}

const HISTORY_LIMIT = 50

export const useTranslateStore = create<TranslateState>()(
  persist(
    (set) => ({
      sourceLang: 'auto',
      targetLang: 'zh',
      providerId: '',
      modelId: '',
      showMarkdown: false,
      autoCopy: false,
      scrollSync: true,
      detectMethod: 'auto',
      bidirectional: false,
      prompt: '', // 空走后端默认
      history: [],

      setMany: (patch) => set(patch),

      pushHistory: (item) =>
        set((s) => ({
          history: [
            { ...item, id: cryptoRandom(), ts: Date.now() },
            ...s.history.filter(
              // 去重:同源同目标同文本视为重复
              (h) => !(h.source === item.source && h.targetLangId === item.targetLangId),
            ),
          ].slice(0, HISTORY_LIMIT),
        })),

      removeHistory: (id) =>
        set((s) => ({ history: s.history.filter((h) => h.id !== id) })),

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'tool-forge:translate',
      version: 2,
      // v1 → v2:重置默认源为 auto、目标为 zh(老用户残留 'en' 强制覆盖);
      //         同时把 markdown 预览默认改为关
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          return {
            ...persisted,
            sourceLang: 'auto',
            targetLang: 'zh',
            showMarkdown: false,
          }
        }
        return persisted
      },
    },
  ),
)

function cryptoRandom(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
