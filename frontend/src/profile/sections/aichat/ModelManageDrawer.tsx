import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Search,
  Plus,
  Minus,
  RefreshCw,
  AlertCircle,
  Loader2,
  PencilLine,
} from 'lucide-react'
import { FetchAIModels, SaveAIProvider } from '../../../../wailsjs/go/main/App'
import type { Provider, ModelInfo, FetchModelsResult } from '@/tools/ai-chat/types'
import { useConfirm } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'

export function ModelManageDrawer({
  provider,
  onClose,
}: {
  provider: Provider
  onClose: () => void
}) {
  const dialog = useConfirm()
  const [loading, setLoading] = useState(true)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set(provider.models))
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [manualOpen, setManualOpen] = useState(false)
  const [manualId, setManualId] = useState('')
  const manualInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const r = (await FetchAIModels(provider.id)) as unknown as FetchModelsResult
      if (!r.ok) {
        setError(r.message ?? '请求失败')
        setModels([])
        return
      }
      const list = r.models ?? []
      list.sort((a, b) => a.id.localeCompare(b.id))
      setModels(list)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [provider.id])

  // 合并:远端拉到的模型 + selected 里但远端没有的(用户手动添加的);
  // 让自定义模型也能在列表里看到并通过 - 按钮移除
  const mergedModels = useMemo(() => {
    const known = new Set(models.map((m) => m.id))
    const extras: ModelInfo[] = []
    for (const id of selected) {
      if (!known.has(id)) extras.push({ id, ownedBy: 'custom' })
    }
    return extras.length ? [...extras, ...models] : models
  }, [models, selected])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return mergedModels
    return mergedModels.filter((m) => m.id.toLowerCase().includes(q))
  }, [mergedModels, filter])

  const grouped = useMemo(() => {
    const map = new Map<string, ModelInfo[]>()
    for (const m of filtered) {
      const groupKey = m.ownedBy === 'custom' ? '自定义' : inferGroup(m.id)
      const arr = map.get(groupKey) ?? []
      arr.push(m)
      map.set(groupKey, arr)
    }
    // 自定义组排最前
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === '自定义') return -1
      if (b[0] === '自定义') return 1
      return a[0].localeCompare(b[0])
    })
  }, [filtered])

  const addManual = async () => {
    const id = manualId.trim()
    if (!id) return
    if (selected.has(id)) {
      setManualId('')
      setManualOpen(false)
      return
    }
    const next = new Set(selected)
    next.add(id)
    setSelected(next)
    setPending((p) => new Set(p).add(id))
    try {
      const r = (await SaveAIProvider({
        ...provider,
        models: Array.from(next),
      } as unknown as never)) as any
      const err = ((r?.[1] ?? r?.['1']) as string) || ''
      if (err) {
        setSelected((prev) => {
          const back = new Set(prev)
          back.delete(id)
          return back
        })
        await dialog({ title: '添加模型失败', message: err, confirmLabel: '知道了' })
      } else {
        setManualId('')
        setManualOpen(false)
      }
    } finally {
      setPending((p) => {
        const next = new Set(p)
        next.delete(id)
        return next
      })
    }
  }

  // 单条点击就立即落库;期间防抖避免连点出问题
  const toggle = async (id: string) => {
    if (pending.has(id)) return
    const willAdd = !selected.has(id)
    const nextSelected = new Set(selected)
    if (willAdd) nextSelected.add(id)
    else nextSelected.delete(id)

    setSelected(nextSelected)
    setPending((p) => new Set(p).add(id))
    try {
      const r = (await SaveAIProvider({
        ...provider,
        models: Array.from(nextSelected),
      } as unknown as never)) as any
      const err = ((r?.[1] ?? r?.['1']) as string) || ''
      if (err) {
        // 回滚 UI
        setSelected((prev) => {
          const back = new Set(prev)
          if (willAdd) back.delete(id)
          else back.add(id)
          return back
        })
        await dialog({
          title: willAdd ? '加入模型失败' : '移除模型失败',
          message: err,
          confirmLabel: '知道了',
        })
      }
    } finally {
      setPending((p) => {
        const next = new Set(p)
        next.delete(id)
        return next
      })
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[78vh] w-[720px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className="text-sm font-semibold">{provider.name} · 模型</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              disabled={loading}
              title="重新拉取 /v1/models"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜索模型 ID..."
                className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setManualOpen((v) => !v)
                setTimeout(() => manualInputRef.current?.focus(), 0)
              }}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs transition-colors',
                manualOpen
                  ? 'border-info/50 bg-info/10 text-info'
                  : 'border-input bg-background text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
              title="部分服务商不提供 /models 接口,可手动输入模型 ID"
            >
              <PencilLine className="h-3.5 w-3.5" />
              手动添加
            </button>
          </div>
          {manualOpen && (
            <div className="flex items-center gap-2">
              <input
                ref={manualInputRef}
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addManual()
                  } else if (e.key === 'Escape') {
                    setManualOpen(false)
                    setManualId('')
                  }
                }}
                placeholder="例如 grok-4.1-fast、glm-4.6 等"
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => void addManual()}
                disabled={!manualId.trim()}
                className="h-8 rounded-md bg-info px-3 text-xs font-medium text-info-foreground transition-colors hover:bg-info/90 disabled:opacity-50"
              >
                添加
              </button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              拉取模型列表中...
            </div>
          ) : error ? (
            <div className="m-4 flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <div>
                <div className="font-medium text-destructive">无法拉取模型列表</div>
                <div className="mt-1 text-xs text-muted-foreground">{error}</div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  请检查 API 密钥与 API 地址是否正确,然后点右上刷新按钮重试。
                </p>
              </div>
            </div>
          ) : grouped.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              无匹配模型
            </div>
          ) : (
            <div className="space-y-3 p-3">
              {grouped.map(([group, list]) => (
                <div key={group}>
                  <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group} <span className="ml-1 normal-case">{list.length}</span>
                  </div>
                  <ul className="space-y-1">
                    {list.map((m) => {
                      const checked = selected.has(m.id)
                      const busy = pending.has(m.id)
                      return (
                        <li
                          key={m.id}
                          onClick={() => void toggle(m.id)}
                          className={cn(
                            'flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 transition-colors',
                            checked
                              ? 'border-info/50 bg-info/10'
                              : 'border-border bg-card hover:bg-secondary/50',
                            busy && 'pointer-events-none opacity-60',
                          )}
                        >
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-info/15 text-[10px] font-semibold text-info">
                            {m.id.slice(0, 1).toUpperCase()}
                          </div>
                          <span className="flex-1 truncate font-mono text-xs">{m.id}</span>
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                          ) : checked ? (
                            <Minus className="h-4 w-4 shrink-0 text-destructive/70" />
                          ) : (
                            <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex h-10 shrink-0 items-center justify-between border-t border-border bg-secondary/30 px-4 text-xs text-muted-foreground">
          <span>
            已选 {selected.size} 个模型(总 {models.length})· 点击即生效
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function inferGroup(id: string): string {
  const lower = id.toLowerCase()
  if (lower.startsWith('gpt-4o')) return 'GPT-4o'
  if (lower.startsWith('gpt-4.1')) return 'GPT-4.1'
  if (lower.startsWith('gpt-4')) return 'GPT-4'
  if (lower.startsWith('gpt-5')) return 'GPT-5'
  if (lower.startsWith('gpt-3.5')) return 'GPT-3.5'
  if (lower.startsWith('o1')) return 'o1'
  if (lower.startsWith('o3')) return 'o3'
  if (lower.startsWith('o4')) return 'o4'
  if (lower.includes('embedding')) return 'Embedding'
  if (lower.includes('whisper')) return 'Whisper'
  if (lower.includes('tts')) return 'TTS'
  if (lower.includes('dall')) return 'DALL·E'
  if (lower.startsWith('claude')) return 'Claude'
  if (lower.startsWith('gemini')) return 'Gemini'
  if (lower.startsWith('deepseek')) return 'DeepSeek'
  if (lower.startsWith('glm')) return 'GLM'
  if (lower.startsWith('qwen')) return 'Qwen'
  if (lower.startsWith('moonshot')) return 'Moonshot'
  return '其他'
}
