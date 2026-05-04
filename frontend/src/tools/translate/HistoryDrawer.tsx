import { createPortal } from 'react-dom'
import { Clock, Trash2, X } from 'lucide-react'
import { useTranslateStore, type TranslateHistoryItem } from './store'
import { findLang } from './languages'
import { Flag } from './Flag'

export function HistoryDrawer({
  onClose,
  onRestore,
}: {
  onClose: () => void
  onRestore: (item: TranslateHistoryItem) => void
}) {
  const history = useTranslateStore((s) => s.history)
  const removeHistory = useTranslateStore((s) => s.removeHistory)
  const clearHistory = useTranslateStore((s) => s.clearHistory)

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-full w-[420px] max-w-full flex-col bg-card shadow-2xl">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-info" />
            <h3 className="text-sm font-semibold">翻译历史</h3>
            <span className="text-[11px] text-muted-foreground">{history.length} 条</span>
          </div>
          <div className="flex items-center gap-1">
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('清空全部历史?')) clearHistory()
                }}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
                清空
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
              还没有翻译历史
            </div>
          ) : (
            <ul className="space-y-1">
              {history.map((item) => {
                const src = findLang(item.sourceLangId)
                const tgt = findLang(item.targetLangId)
                return (
                  <li
                    key={item.id}
                    onClick={() => onRestore(item)}
                    className="group cursor-pointer rounded-md border border-border bg-card px-3 py-2.5 transition-colors hover:border-info/30 hover:bg-info/5"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Flag code={src?.country} />
                        <span>→</span>
                        <Flag code={tgt?.country} />
                        <span className="ml-1">{tgt?.label ?? item.targetLangId}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>{formatTs(item.ts)}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            removeHistory(item.id)
                          }}
                          className="hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                          title="删除"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="line-clamp-2 text-sm text-foreground">{item.source}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.target}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `${hh}:${mm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}
