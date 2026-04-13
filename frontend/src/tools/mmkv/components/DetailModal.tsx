import { useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TYPE_BG,
  TYPE_LABELS,
  decodeAs,
  toHexSpaced,
  type MMKVType,
} from '../logic/decoders'

interface DetailContext {
  key: string
  index: number
  total: number
  bytes: Uint8Array
  type: MMKVType
}

interface Props {
  ctx: DetailContext
  onClose: () => void
}

export function DetailModal({ ctx, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const label = ctx.total > 1 ? `历史 ${ctx.index === 0 ? '最新' : ctx.index}` : '当前'
  const res = decodeAs(ctx.bytes, ctx.type)
  const displayText = res.ok ? res.display : `N/A — ${res.reason}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{ctx.key}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{label}</span>
              <span>·</span>
              <span>{ctx.bytes.length} bytes</span>
              <span>·</span>
              <span
                className={cn(
                  'rounded-sm px-1.5 py-0.5 font-medium text-orange-600 dark:text-orange-400',
                  TYPE_BG[ctx.type]
                )}
              >
                {TYPE_LABELS[ctx.type]}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* 主展示：当前类型的完整解码值 */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {TYPE_LABELS[ctx.type]} 解码
              </div>
              {res.ok && <CopyButton getText={() => res.display} />}
            </div>
            <div
              className={cn(
                'whitespace-pre-wrap break-all rounded-md border border-border p-3 font-mono text-[12.5px] leading-relaxed',
                res.ok ? 'text-foreground' : 'italic text-muted-foreground',
                TYPE_BG[ctx.type]
              )}
            >
              {displayText}
            </div>
          </section>

          {/* 辅展示：原始字节 hex */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                原始字节（hex）
              </div>
              <CopyButton
                getText={() =>
                  toHexSpaced(ctx.bytes, Number.MAX_SAFE_INTEGER).replace(/ /g, '')
                }
              />
            </div>
            <div className="break-all rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {toHexSpaced(ctx.bytes, 4096)}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function CopyButton({
  getText,
  className,
}: {
  getText: () => string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const doCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      onClick={doCopy}
      title="复制"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className
      )}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-500" />
          已复制
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          复制
        </>
      )}
    </button>
  )
}

export type { DetailContext }
