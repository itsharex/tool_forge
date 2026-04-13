import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { computeInspector, type InspectorValues } from '../logic/inspector'

interface InspectorProps {
  bytes: Uint8Array
  cursor: number
  collapsed: boolean
  onToggle: () => void
}

export function Inspector({ bytes, cursor, collapsed, onToggle }: InspectorProps) {
  const values = useMemo(() => computeInspector(bytes, cursor), [bytes, cursor])
  const [showHex, setShowHex] = useState(false)

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        title="展开 Inspector"
        className="flex h-full w-7 items-center justify-center border-l border-border bg-card text-muted-foreground hover:bg-accent"
      >
        <ChevronRight className="h-4 w-4 rotate-180" />
      </button>
    )
  }

  return (
    <div className="flex h-full w-72 flex-col border-l border-border bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium">Inspector</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHex((v) => !v)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
              showHex
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
            title="切换十进制 / 十六进制显示"
          >
            {showHex ? 'HEX' : 'DEC'}
          </button>
          <button
            onClick={onToggle}
            title="收起"
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="mb-3 text-[11px] text-muted-foreground">
          光标偏移 <code className="font-mono">0x{cursor.toString(16).toUpperCase()}</code>
        </div>
        <Section title="整数（小端 / 大端）">
          <Pair name="int8" v={values.int8} hex={showHex} bits={8} />
          <Pair name="uint8" v={values.uint8} hex={showHex} bits={8} unsigned />
          <Pair name="int16 LE" v={values.int16le} hex={showHex} bits={16} />
          <Pair name="int16 BE" v={values.int16be} hex={showHex} bits={16} />
          <Pair name="uint16 LE" v={values.uint16le} hex={showHex} bits={16} unsigned />
          <Pair name="uint16 BE" v={values.uint16be} hex={showHex} bits={16} unsigned />
          <Pair name="int32 LE" v={values.int32le} hex={showHex} bits={32} />
          <Pair name="int32 BE" v={values.int32be} hex={showHex} bits={32} />
          <Pair name="uint32 LE" v={values.uint32le} hex={showHex} bits={32} unsigned />
          <Pair name="uint32 BE" v={values.uint32be} hex={showHex} bits={32} unsigned />
          <Pair name="int64 LE" v={values.int64le} hex={showHex} bits={64} />
          <Pair name="int64 BE" v={values.int64be} hex={showHex} bits={64} />
          <Pair name="uint64 LE" v={values.uint64le} hex={showHex} bits={64} unsigned />
          <Pair name="uint64 BE" v={values.uint64be} hex={showHex} bits={64} unsigned />
        </Section>
        <Section title="浮点">
          <Pair name="float32 LE" v={values.float32le} hex={false} />
          <Pair name="float32 BE" v={values.float32be} hex={false} />
          <Pair name="float64 LE" v={values.float64le} hex={false} />
          <Pair name="float64 BE" v={values.float64be} hex={false} />
        </Section>
        <Section title="字符">
          <Pair name="ASCII" v={values.asciiChar} hex={false} raw />
        </Section>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-0.5 rounded-md border border-border bg-muted/30 p-1.5">
        {children}
      </div>
    </div>
  )
}

function Pair({
  name,
  v,
  hex,
  bits,
  unsigned,
  raw,
}: {
  name: string
  v: number | bigint | string | null
  hex: boolean
  bits?: number
  unsigned?: boolean
  raw?: boolean
}) {
  const display = formatValue(v, hex, bits, unsigned, raw)
  return (
    <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
      <span className="text-muted-foreground">{name}</span>
      <span
        className={cn('truncate', v == null ? 'text-muted-foreground/40' : 'text-foreground')}
      >
        {display}
      </span>
    </div>
  )
}

function formatValue(
  v: number | bigint | string | null,
  hex: boolean,
  bits?: number,
  unsigned?: boolean,
  raw?: boolean
): string {
  if (v == null) return '—'
  if (typeof v === 'string') return raw ? `'${v}'` : v
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return v.toString()
    if (Number.isInteger(v) && hex && bits) {
      const u = unsigned ? v : signedToUnsigned(v, bits)
      return '0x' + u.toString(16).toUpperCase().padStart(bits / 4, '0')
    }
    return v.toString()
  }
  if (typeof v === 'bigint') {
    if (hex && bits) {
      const u = unsigned ? v : bigSignedToUnsigned(v, bits)
      return '0x' + u.toString(16).toUpperCase().padStart(bits / 4, '0')
    }
    return v.toString()
  }
  return '—'
}

function signedToUnsigned(v: number, bits: number): number {
  if (v >= 0) return v
  return v + 2 ** bits
}

function bigSignedToUnsigned(v: bigint, bits: number): bigint {
  if (v >= 0n) return v
  return v + (1n << BigInt(bits))
}
