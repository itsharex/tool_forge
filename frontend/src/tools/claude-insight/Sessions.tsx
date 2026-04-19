import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Download,
  Folder,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ExportClaudeSessions,
  ImportClaudeSessions,
  ListClaudeSessions,
  PickClaudeExportPath,
  PickClaudeImportPath,
} from '../../../wailsjs/go/main/App'
import type { claudeinsight } from '../../../wailsjs/go/models'
import { formatDateTime, formatDuration, formatRelative } from './lib/format'
import { SessionDetail } from './SessionDetail'

type Item = claudeinsight.SessionListItem

interface SessionsProps {
  reloadToken: number
}

export function Sessions({ reloadToken }: SessionsProps) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [claudeDir, setClaudeDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<Item | null>(null)
  const [busy, setBusy] = useState(false)
  const [importResult, setImportResult] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ListClaudeSessions('')
      .then((r) => {
        if (cancelled) return
        setItems(r.items ?? [])
        setClaudeDir(r.claude_dir)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const exportOne = async (it: Item, ev: React.MouseEvent) => {
    ev.stopPropagation()
    try {
      setBusy(true)
      const defaultName = `${(it.id || 'session').slice(0, 8)}-${Date.now()}.zip`
      const dest = await PickClaudeExportPath(defaultName)
      if (!dest) return // 用户取消
      const r = await ExportClaudeSessions([it.file_path], dest)
      setImportResult(`已导出 ${r.sessions} 个会话到 ${r.zip_path}`)
      setTimeout(() => setImportResult(''), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const importZip = async () => {
    try {
      setBusy(true)
      const src = await PickClaudeImportPath()
      if (!src) return
      const r = await ImportClaudeSessions(src)
      const parts: string[] = []
      if (r.imported > 0) parts.push(`导入 ${r.imported} 个`)
      if (r.skipped > 0) parts.push(`跳过 ${r.skipped} 个(已存在)`)
      setImportResult(parts.join(' · ') || '未导入任何会话')
      setTimeout(() => setImportResult(''), 4000)
      // 刷新列表
      setItems(null)
      const list = await ListClaudeSessions('')
      setItems(list.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const filtered = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => {
      const bag = `${it.project} ${it.preview} ${it.id}`.toLowerCase()
      return bag.includes(q)
    })
  }, [items, query])

  if (loading && !items) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        正在加载会话列表...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <div className="max-w-md text-sm text-muted-foreground">{error}</div>
      </div>
    )
  }

  if (opened) {
    return (
      <SessionDetail
        filePath={opened.file_path}
        project={opened.project}
        onBack={() => setOpened(null)}
      />
    )
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Sparkles className="h-10 w-10 text-indigo-500" />
        <div className="space-y-1">
          <h2 className="text-base font-medium">暂无会话</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            在 <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">{claudeDir}</code>{' '}
            下没有读到任何会话文件。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      <Toolbar
        items={items}
        filtered={filtered}
        query={query}
        onQuery={setQuery}
        onImport={importZip}
        busy={busy}
      />
      {importResult && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          {importResult}
        </div>
      )}
      {filtered.length === 0 ? (
        <EmptyFilter />
      ) : (
        <ul className="space-y-2">
          {filtered.map((it) => (
            <SessionRow
              key={it.id || it.file_path}
              item={it}
              onOpen={() => setOpened(it)}
              onExport={(ev) => exportOne(it, ev)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Toolbar({
  items,
  filtered,
  query,
  onQuery,
  onImport,
  busy,
}: {
  items: Item[]
  filtered: Item[]
  query: string
  onQuery: (v: string) => void
  onImport: () => void
  busy: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="搜索项目路径或首条消息..."
          className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm outline-none focus:border-foreground/30"
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onImport} disabled={busy}>
        <Upload className="h-3.5 w-3.5" />
        导入 ZIP
      </Button>
      <span className="shrink-0 text-xs text-muted-foreground">
        {filtered.length === items.length ? `${items.length} 个` : `${filtered.length} / ${items.length}`}
      </span>
    </div>
  )
}

function EmptyFilter() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
      没有匹配的会话
    </div>
  )
}

function SessionRow({
  item,
  onOpen,
  onExport,
}: {
  item: Item
  onOpen: () => void
  onExport: (ev: React.MouseEvent) => void
}) {
  const started = new Date(item.started_at)
  const ended = new Date(item.ended_at)
  const duration =
    Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime())
      ? 0
      : Math.floor((ended.getTime() - started.getTime()) / 1000)

  return (
    <li className="group relative">
      <button
        onClick={onOpen}
        className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card p-3 pr-10 text-left transition-colors hover:border-indigo-500/40 hover:bg-indigo-500/5"
      >
        <div className="flex items-center gap-2 text-xs">
          <Folder className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={item.project}>
            {item.project || '—'}
          </span>
          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
            {item.messages} 条
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatRelative(item.ended_at)}
          </span>
        </div>
        <div className="line-clamp-2 text-sm text-foreground/90">
          {item.preview || <span className="italic text-muted-foreground">（无文本预览）</span>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {formatDateTime(item.started_at)}
          </span>
          {duration > 0 && <span>时长 {formatDuration(duration)}</span>}
        </div>
      </button>
      <button
        onClick={onExport}
        title="导出为 ZIP"
        className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-indigo-500/15 hover:text-indigo-600 dark:hover:text-indigo-300 group-hover:inline-flex"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}
