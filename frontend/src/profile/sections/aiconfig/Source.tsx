import { FileText } from 'lucide-react'
import type { aiconfig } from '../../../../wailsjs/go/models'
import { cn } from '@/lib/utils'

const ORIGIN_LABEL: Record<string, { text: string; cls: string }> = {
  claude: { text: 'Claude', cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
  codex: { text: 'Codex', cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  toolforge: { text: '工具箱', cls: 'bg-violet-500/15 text-violet-500' },
}

/** 哪家的。三家的东西混在一列里,不标一眼分不出来 */
export function OriginBadge({ origin }: { origin: string }) {
  const it = ORIGIN_LABEL[origin] ?? { text: origin, cls: 'bg-muted text-muted-foreground' }
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', it.cls)}>
      {it.text}
    </span>
  )
}

/**
 * 出处那一行。
 *
 * 这一行是整个页面的理由:不写明出自哪个文件,汇总就只是把四个地方的东西
 * 混成一锅,反而比分开看更难查 —— 看到一条不对劲的,却不知道该去改哪儿。
 */
export function SourceLine({
  source,
  onOpen,
  openable = true,
}: {
  source: aiconfig.Source
  onOpen: (path: string) => void
  openable?: boolean
}) {
  return (
    <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
      <span className="shrink-0">{source.scope}</span>
      <span className="opacity-40">·</span>
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
        <span className="min-w-0 truncate font-mono" title={source.file}>
          {source.file}
        </span>
      )}
    </div>
  )
}
