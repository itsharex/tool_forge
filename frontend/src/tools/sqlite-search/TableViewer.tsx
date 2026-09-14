import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Table2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ListSQLiteTables, ReadSQLiteRows } from '../../../wailsjs/go/main/App'
import type { sqlitex } from '../../../wailsjs/go/models'
import { cn } from '@/lib/utils'
import { cellText, type Table } from './types'

const PAGE = 100

interface Props {
  /** 库的绝对路径 */
  path: string
  /** 打开时直接跳到这张表 */
  initialTable?: string
  /** 不给就不显示关闭按钮 —— 嵌在预览面板里时没有"关掉"这回事 */
  onClose?: () => void
}

/**
 * 表浏览器。
 *
 * 搜索给的是"哪一行命中了",而人下一步总要看这一行周围还有什么 ——
 * 同一个会话的其它消息、同一个联系人的其它记录。少了这一步,
 * 搜索结果只能当线索,没法当证据看。
 */
export function TableViewer({ path, initialTable, onClose }: Props) {
  const [tables, setTables] = useState<Table[]>([])
  const [active, setActive] = useState(initialTable ?? '')
  const [page, setPage] = useState<sqlitex.Page | null>(null)
  const [offset, setOffset] = useState(0)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let stale = false
    ListSQLiteTables(path)
      .then((ts) => {
        if (stale) return
        setTables(ts)
        if (!initialTable && ts.length > 0) setActive(ts[0].name)
      })
      .catch((e) => !stale && setErr(String(e)))
    return () => {
      stale = true
    }
  }, [path, initialTable])

  const load = useCallback(
    (table: string, off: number) => {
      if (!table) return
      setLoading(true)
      setErr('')
      ReadSQLiteRows(path, table, off, PAGE)
        .then(setPage)
        .catch((e) => {
          setPage(null)
          setErr(String(e))
        })
        .finally(() => setLoading(false))
    },
    [path],
  )

  useEffect(() => {
    setOffset(0)
    load(active, 0)
  }, [active, load])

  const total = page?.total ?? -1
  const hasPrev = offset > 0
  const hasNext = total >= 0 ? offset + PAGE < total : (page?.rows.length ?? 0) === PAGE

  const go = (next: number) => {
    setOffset(next)
    load(active, next)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs" dir="rtl" title={path}>
          {path}
        </span>
        {onClose && (
          <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 表列表。行数直接标出来 —— 取证时空表可以一眼跳过 */}
        <div className="w-52 shrink-0 overflow-auto border-r border-border">
          {tables.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => setActive(t.name)}
              className={cn(
                'flex w-full items-baseline gap-1.5 px-2.5 py-1.5 text-left text-xs transition-colors',
                t.name === active ? 'bg-secondary font-medium' : 'hover:bg-secondary/50',
              )}
              title={t.err || `${t.columns.length} 列`}
            >
              <span className="truncate font-mono">{t.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {t.err ? '读不了' : t.rows < 0 ? '—' : t.rows}
              </span>
            </button>
          ))}
          {tables.length === 0 && !err && (
            <div className="p-3 text-xs text-muted-foreground">这个库里没有表</div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            {err && <div className="p-3 text-xs text-destructive">{err}</div>}
            {!err && page && (
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    {page.columns.map((c) => (
                      <th
                        key={c}
                        className="whitespace-nowrap border-b border-border px-2 py-1 text-left font-mono font-medium"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-secondary/40">
                      {row.map((c, j) => (
                        <td
                          key={j}
                          className="max-w-[28rem] truncate border-b border-border/50 px-2 py-1 font-mono"
                          title={cellText(c)}
                        >
                          {c.null ? (
                            <span className="italic text-muted-foreground">NULL</span>
                          ) : (
                            cellText(c)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!err && page && page.rows.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">这张表是空的</div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>
              {loading
                ? '读取中…'
                : total >= 0
                  ? `第 ${offset + 1}–${offset + (page?.rows.length ?? 0)} 行，共 ${total}`
                  : `第 ${offset + 1} 行起`}
            </span>
            <div className="ml-auto flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev || loading}
                onClick={() => go(Math.max(0, offset - PAGE))}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext || loading}
                onClick={() => go(offset + PAGE)}
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
