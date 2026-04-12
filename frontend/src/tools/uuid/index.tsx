import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { ToolShell } from '@/components/tool/ToolShell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { meta } from './meta'
import { generateMany, transform } from './logic'

export default function Uuid() {
  const [count, setCount] = useState(5)
  const [uppercase, setUppercase] = useState(false)
  const [withHyphen, setWithHyphen] = useState(true)
  const [ids, setIds] = useState<string[]>([])
  const [copied, setCopied] = useState<string | 'all' | ''>('')

  useEffect(() => {
    setIds(generateMany(5))
  }, [])

  const formatted = ids.map((id) => transform(id, { uppercase, withHyphen }))

  const regenerate = () => {
    const safeCount = Math.max(1, Math.min(count, 500))
    setIds(generateMany(safeCount))
  }

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key as string | 'all')
    setTimeout(() => setCopied(''), 1200)
  }

  return (
    <ToolShell
      title={meta.title}
      description={meta.description}
      onClear={() => setIds([])}
      actions={
        <Button variant="default" size="sm" onClick={regenerate}>
          <RefreshCw className="h-3.5 w-3.5" />
          重新生成
        </Button>
      }
    >
      <div className="mx-auto flex h-full max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-4">
          <Control label="数量">
            <input
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 1)}
              className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm outline-none"
            />
          </Control>
          <Toggle checked={uppercase} onChange={setUppercase} label="大写" />
          <Toggle checked={withHyphen} onChange={setWithHyphen} label="包含短横线" />
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy(formatted.join('\n'), 'all')}
              disabled={formatted.length === 0}
            >
              <Copy className="h-3.5 w-3.5" />
              {copied === 'all' ? '已复制全部' : '复制全部'}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded-lg border border-border bg-card">
          {formatted.length === 0 ? (
            <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
              点击"重新生成"开始
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {formatted.map((id, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-accent/50"
                >
                  <span className="w-8 text-right font-mono text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <code className="flex-1 truncate font-mono text-sm">{id}</code>
                  <button
                    onClick={() => copy(id, String(i))}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {copied === String(i) ? '已复制' : '复制'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ToolShell>
  )
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md border px-3 text-sm transition-colors',
        checked
          ? 'border-foreground/30 bg-accent font-medium'
          : 'border-input bg-background hover:bg-accent'
      )}
    >
      <span
        className={cn(
          'h-3.5 w-3.5 rounded-sm border',
          checked ? 'border-foreground bg-foreground' : 'border-muted-foreground/40'
        )}
      />
      {label}
    </button>
  )
}
