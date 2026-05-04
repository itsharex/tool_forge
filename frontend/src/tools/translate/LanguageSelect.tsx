import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { LANGUAGES, findLang } from './languages'
import { Flag } from './Flag'
import { cn } from '@/lib/utils'

export function LanguageSelect({
  value,
  onChange,
  showAuto = false,
  className,
}: {
  value: string
  onChange: (id: string) => void
  showAuto?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const cur = findLang(value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return LANGUAGES.filter((l) => {
      if (!showAuto && l.id === 'auto') return false
      if (!q) return true
      return (
        l.label.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q)
      )
    })
  }, [filter, showAuto])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setFilter('')
        }}
        className="flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm transition-colors hover:bg-secondary"
      >
        <Flag code={cur?.country} />
        <span className="font-medium">{cur?.label ?? value}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜索语言..."
                className="h-7 w-full rounded border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {list.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(l.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-secondary',
                    value === l.id && 'bg-info/10 text-info',
                  )}
                >
                  <Flag code={l.country} />
                  <span className="flex-1 truncate">{l.label}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{l.id}</span>
                </button>
              </li>
            ))}
            {list.length === 0 && (
              <li className="px-3 py-3 text-center text-xs text-muted-foreground">
                没有匹配的语言
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
