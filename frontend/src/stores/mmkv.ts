import { create } from 'zustand'
import type { ParseResult } from '@/tools/mmkv/logic/parser'
import type { MMKVType } from '@/tools/mmkv/logic/decoders'

export interface LoadedFile {
  name: string
  size: number
  parse: ParseResult
  encrypted: boolean
}

export type TypesMap = Record<string, MMKVType[]>

interface MmkvState {
  file: LoadedFile | null
  typesByKey: TypesMap
  search: string
  /** Key 列宽度（像素），持久于会话内 */
  keyColWidth: number

  setFile: (f: LoadedFile | null) => void
  setTypesByKey: (t: TypesMap) => void
  cycleType: (key: string, index: number, next: MMKVType) => void
  setSearch: (s: string) => void
  setKeyColWidth: (px: number) => void
  reset: () => void
}

/**
 * MMKV 工具状态。刻意不走 persist —— Uint8Array 不适合 localStorage，
 * 只要保证切换路由不丢（组件卸载后 store 仍在内存中）即可。
 */
export const useMmkvStore = create<MmkvState>((set) => ({
  file: null,
  typesByKey: {},
  search: '',
  keyColWidth: 260,

  setFile: (f) => set({ file: f }),
  setTypesByKey: (t) => set({ typesByKey: t }),
  cycleType: (key, index, next) =>
    set((s) => {
      const arr = s.typesByKey[key] ?? []
      const nextArr = [...arr]
      nextArr[index] = next
      return { typesByKey: { ...s.typesByKey, [key]: nextArr } }
    }),
  setSearch: (s) => set({ search: s }),
  setKeyColWidth: (px) => set({ keyColWidth: px }),
  reset: () =>
    set({ file: null, typesByKey: {}, search: '' }),
}))
