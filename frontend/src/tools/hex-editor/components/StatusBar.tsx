import { formatBytes } from '../logic/format'
import type { EncodingId } from '../logic/encodings'

interface StatusBarProps {
  fileName: string
  total: number
  cursor: number
  encoding: EncodingId
}

export function StatusBar({ fileName, total, cursor, encoding }: StatusBarProps) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3">
        {fileName && <span className="truncate">{fileName}</span>}
        <span>{formatBytes(total)}</span>
      </div>
      <div className="flex items-center gap-3 font-mono">
        <span>
          offset: 0x{cursor.toString(16).toUpperCase()} ({cursor})
        </span>
        <span>编码: {encoding}</span>
      </div>
    </div>
  )
}
