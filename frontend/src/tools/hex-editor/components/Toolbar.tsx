import { useState } from 'react'
import { ChevronRight, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ENCODINGS, type EncodingId } from '../logic/encodings'
import type { Radix } from '../logic/format'
import { parseOffset } from '../logic/format'

interface ToolbarProps {
  hasFile: boolean
  radix: Radix
  encoding: EncodingId
  onRadixChange: (r: Radix) => void
  onEncodingChange: (e: EncodingId) => void
  onPickFile: () => void
  onJumpTo: (off: number) => void
  total: number
}

const RADIXES: { id: Radix; label: string }[] = [
  { id: 'hex', label: 'HEX' },
  { id: 'dec', label: 'DEC' },
  { id: 'oct', label: 'OCT' },
  { id: 'bin', label: 'BIN' },
]

export function Toolbar({
  hasFile,
  radix,
  encoding,
  onRadixChange,
  onEncodingChange,
  onPickFile,
  onJumpTo,
  total,
}: ToolbarProps) {
  const [jumpInput, setJumpInput] = useState('')
  const [jumpError, setJumpError] = useState(false)

  const doJump = () => {
    const off = parseOffset(jumpInput)
    if (off == null || off >= total) {
      setJumpError(true)
      return
    }
    setJumpError(false)
    onJumpTo(off)
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
      <Button variant="outline" size="sm" onClick={onPickFile}>
        <FolderOpen className="h-3.5 w-3.5" />
        打开
      </Button>

      {hasFile && (
        <>
          <div className="mx-1 h-5 w-px bg-border" />

          {/* 跳转 */}
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">跳转</span>
            <input
              value={jumpInput}
              onChange={(e) => {
                setJumpInput(e.target.value)
                setJumpError(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doJump()
              }}
              placeholder="0x100 / 256"
              spellCheck={false}
              className={cn(
                'h-7 w-28 rounded-md border bg-background px-2 font-mono text-xs outline-none',
                jumpError
                  ? 'border-destructive focus:ring-1 focus:ring-destructive'
                  : 'border-input focus:ring-1 focus:ring-ring'
              )}
            />
            <Button variant="ghost" size="sm" onClick={doJump} className="h-7 w-7 p-0">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="mx-1 h-5 w-px bg-border" />

          {/* 进制 */}
          <div className="flex items-center gap-0.5 rounded-md border border-input p-0.5">
            {RADIXES.map((r) => (
              <button
                key={r.id}
                onClick={() => onRadixChange(r.id)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                  radix === r.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* 编码 */}
          <select
            value={encoding}
            onChange={(e) => onEncodingChange(e.target.value as EncodingId)}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            {ENCODINGS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}
