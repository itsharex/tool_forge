import { useState } from 'react'
import { ChevronRight, Database, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cellText, groupByFile, highlight, hitIndex, type Hit } from './types'

interface Props {
  hits: Hit[]
  onOpenTable: (file: string, table: string) => void
}

export function HitList({ hits, onOpenTable }: Props) {
  const groups = groupByFile(hits)
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <FileGroup key={g.file} file={g.file} hits={g.hits} onOpenTable={onOpenTable} />
      ))}
    </div>
  )
}

function FileGroup({
  file,
  hits,
  onOpenTable,
}: {
  file: string
  hits: Hit[]
  onOpenTable: (file: string, table: string) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/70"
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {/* 路径从右往左看更有用:末尾的库名才是人要认的那部分 */}
        <span className="truncate font-mono" dir="rtl" title={file}>
          {file}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground">{hits.length} 行</span>
      </button>
      {open && (
        <div className="divide-y divide-border">
          {hits.map((h, i) => (
            <HitRow key={i} hit={h} onOpenTable={onOpenTable} />
          ))}
        </div>
      )}
    </div>
  )
}

function HitRow({
  hit,
  onOpenTable,
}: {
  hit: Hit
  onOpenTable: (file: string, table: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const idx = hitIndex(hit)
  const matched = idx >= 0 ? hit.row[idx] : undefined

  return (
    <div className="px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenTable(hit.file, hit.table)}
          className="flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:bg-secondary"
          title="打开这张表"
        >
          <Table2 className="h-3 w-3" />
          {hit.table}
        </button>
        {hit.column && (
          <span className="font-mono text-[11px] text-muted-foreground">· {hit.column}</span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? '收起整行' : `展开整行（${hit.columns.length} 列）`}
        </button>
      </div>

      {/* 默认只展示命中的那一格 —— 一行几十列全铺出来根本看不清哪里命中了 */}
      {!expanded && matched && (
        <div className="mt-1 break-all rounded bg-muted/40 px-2 py-1 font-mono leading-relaxed">
          {highlight(cellText(matched), hit.keyword).map((p, i) => (
            <span key={i} className={p.hit ? 'rounded bg-amber-400/40 font-medium' : undefined}>
              {p.s}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {hit.columns.map((col, i) => {
                const c = hit.row[i]
                return (
                  <tr key={col} className={cn('align-top', i === idx && 'bg-amber-400/10')}>
                    <td className="whitespace-nowrap py-0.5 pr-3 font-mono text-muted-foreground">
                      {col}
                    </td>
                    <td className="break-all py-0.5 font-mono">
                      {c?.null ? (
                        <span className="italic text-muted-foreground">NULL</span>
                      ) : (
                        <>
                          {highlight(cellText(c), i === idx ? hit.keyword : '').map((p, j) => (
                            <span
                              key={j}
                              className={p.hit ? 'rounded bg-amber-400/40 font-medium' : undefined}
                            >
                              {p.s}
                            </span>
                          ))}
                          {c?.blob && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              (BLOB {c.size} 字节)
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
