import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'
export type StyleId = 'minimal' | 'nebula'

interface LayoutState {
  sidebarCollapsed: boolean
  theme: Theme
  styleId: StyleId
  toggleSidebar: () => void
  setTheme: (theme: Theme) => void
  setStyle: (styleId: StyleId) => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'system',
      styleId: 'minimal',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTheme: (theme) => set({ theme }),
      setStyle: (styleId) => set({ styleId }),
    }),
    { name: 'tool-forge:layout' }
  )
)

export function applyAppearance(theme: Theme, styleId: StyleId) {
  const root = document.documentElement
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  root.classList.toggle('dark', resolved === 'dark')
  if (styleId === 'minimal') {
    root.removeAttribute('data-style')
  } else {
    root.setAttribute('data-style', styleId)
  }
}
