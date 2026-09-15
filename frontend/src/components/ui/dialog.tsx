import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 通用弹窗外壳。
 *
 * 这个代码库原来没有共用弹窗,二十来个对话框各写各的 —— 于是 Esc 关不关、点背景关不关、
 * 用不用 portal(不用的话会被祖先的 overflow / transform 裁掉)全看当时谁写的。
 * 这里把这些行为定死一份。
 *
 * 只管外壳:标题栏、关闭、滚动区。按钮和表单由调用方放进 children / footer,
 * 因为每个弹窗的动作都不一样,硬塞一套 confirm/cancel 反而会被绕开。
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  width = 'w-[520px]',
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** 标题下面那行小字,说清这个弹窗管的是什么 */
  description?: string
  /** tailwind 宽度类 */
  width?: string
  footer?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-6"
      // 用 mousedown 而不是 click:在弹窗里按下、松手时滑到了外面,
      // click 会判在背景上,于是拖选一段文字就能把弹窗关掉
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={cn(
          'flex max-h-[85vh] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl',
          width,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            title="关闭（Esc）"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-xs">{children}</div>

        {footer && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-secondary/30 px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
