import { FileText, Link2 } from 'lucide-react'
import type { aiconfig } from '../../../wailsjs/go/models'
import { cn } from '@/lib/utils'
import { originMeta } from './origins'

/** 哪家的。多家的东西混在一列里,靠颜色一眼分出谁是谁 */
export function OriginBadge({ origin, className }: { origin: string; className?: string }) {
  const m = originMeta(origin)
  const Icon = m.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        m.chip,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {m.name}
    </span>
  )
}

/**
 * 出处那一行。
 *
 * 这一行是整个页面的理由:不写明出自哪个文件,汇总就只是把几个地方的东西
 * 混成一锅,反而比分开看更难查 —— 看到一条不对劲的,却不知道该去改哪儿。
 */
export function SourceLine({
  source,
  linkTarget,
  onOpen,
  openable = true,
}: {
  source: aiconfig.Source
  /** 软链真正指向哪里;有就显示,免得同一份被当成三份 */
  linkTarget?: string
  onOpen: (path: string) => void
  openable?: boolean
}) {
  return (
    <div className="mt-2.5 space-y-1 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 rounded bg-muted px-1.5 py-px">{source.scope}</span>
        {openable ? (
          <button
            onClick={() => onOpen(source.file)}
            title={`打开 ${source.file}`}
            className="flex min-w-0 items-center gap-1 font-mono underline-offset-2 hover:text-foreground hover:underline"
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">{source.file}</span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-1 font-mono" title={source.file}>
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">{source.file}</span>
          </span>
        )}
      </div>
      {linkTarget && (
        <div className="flex items-center gap-1.5 pl-0.5" title={linkTarget}>
          <Link2 className="h-3 w-3 shrink-0" />
          <span className="shrink-0">软链 →</span>
          <span className="truncate font-mono">{linkTarget}</span>
        </div>
      )}
    </div>
  )
}
