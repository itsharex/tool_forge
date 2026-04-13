import { ChevronsRight, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TYPE_BG,
  TYPE_LABELS,
  decodeAs,
  type MMKVType,
} from '../logic/decoders'

interface Props {
  bytes: Uint8Array
  type: MMKVType
  onCycle: () => void
  onExpand: () => void
}

export function ValueCell({ bytes, type, onCycle, onExpand }: Props) {
  const res = decodeAs(bytes, type)
  const displayText = res.ok ? res.display : 'N/A'

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(displayText)
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-sm px-3 py-1.5 font-mono text-[12.5px] transition-colors',
        TYPE_BG[type]
      )}
    >
      {/* 类型徽章：点击循环切换 */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onCycle()
        }}
        className="shrink-0 text-[11px] text-orange-600 transition-opacity hover:opacity-70 dark:text-orange-400"
        title="点击循环切换类型"
      >
        ({TYPE_LABELS[type]})
      </button>

      {/* 值本体：单行截断；点击循环切换类型（展开看完整值请点右侧按钮） */}
      <div
        onClick={onCycle}
        className={cn(
          'min-w-0 flex-1 cursor-pointer truncate',
          res.ok ? 'text-foreground' : 'italic text-muted-foreground'
        )}
        title="点击循环切换类型"
      >
        {displayText}
      </div>

      {/* 复制：hover 时浮出 */}
      <button
        onClick={copy}
        title="复制当前解码结果"
        className="shrink-0 rounded p-1 text-muted-foreground/70 opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>

      {/* 展开：常驻，位于值的末尾 */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onExpand()
        }}
        title="展开查看完整值"
        className="shrink-0 rounded px-1.5 py-1 text-[10px] font-medium text-muted-foreground/80 transition-colors hover:bg-background/60 hover:text-foreground"
      >
        <ChevronsRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
