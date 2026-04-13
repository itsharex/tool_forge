import { useMemo, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { ToolShell } from '@/components/tool/ToolShell'
import { TextPanel } from '@/components/tool/TextPanel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useFileDrop } from '@/lib/useFileDrop'
import { meta } from './meta'
import { jsonToGo } from './logic'

const EXAMPLE = JSON.stringify(
  {
    id: 42,
    name: 'Alice',
    active: true,
    tags: ['admin', 'beta'],
    profile: {
      avatar: 'https://example.com/a.png',
      bio: null,
    },
    posts: [
      { id: 1, title: 'Hello', likes: 3.5 },
      { id: 2, title: 'World', likes: 0 },
    ],
  },
  null,
  2
)

export default function JsonToGo() {
  const [input, setInput] = useState('')
  const [rootName, setRootName] = useState('Root')
  const [useOmitempty, setUseOmitempty] = useState(false)
  const [usePointers, setUsePointers] = useState(false)
  const [dropError, setDropError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: '', error: '' }
    try {
      return {
        output: jsonToGo(input, { rootName, useOmitempty, usePointers }),
        error: '',
      }
    } catch (e) {
      return { output: '', error: e instanceof Error ? e.message : '解析失败' }
    }
  }, [input, rootName, useOmitempty, usePointers])

  const { dragOver, dragHandlers } = useFileDrop({
    accept: ['.json', '.txt'],
    onLoad: (r) => {
      if (r.kind === 'text') {
        setInput(r.text)
        setDropError('')
      }
    },
    onError: (msg) => setDropError(msg),
  })

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      setInput(text)
      setDropError('')
    } catch (e) {
      setDropError(e instanceof Error ? e.message : '读取文件失败')
    }
  }

  return (
    <ToolShell
      title={meta.title}
      description={meta.description}
      onClear={() => setInput('')}
      onLoadExample={() => setInput(EXAMPLE)}
      actions={
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImport(f)
              e.target.value = ''
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            导入
          </Button>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">名称</span>
            <input
              value={rootName}
              onChange={(e) => setRootName(e.target.value || 'Root')}
              className="h-7 w-24 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none"
            />
          </label>
          <Toggle
            checked={useOmitempty}
            onChange={setUseOmitempty}
            label="omitempty"
          />
          <Toggle checked={usePointers} onChange={setUsePointers} label="指针嵌套" />
        </div>
      }
    >
      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-2">
        <div
          {...dragHandlers}
          className={cn(
            'relative flex min-h-[280px] flex-col rounded-lg transition',
            dragOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
          )}
        >
          <TextPanel
            label="JSON 输入"
            value={input}
            onChange={setInput}
            error={error || dropError}
            placeholder='粘贴 JSON，或将 .json 文件拖到此处…'
          />
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary">
              松开以导入文件
            </div>
          )}
        </div>
        <TextPanel label="Go struct" value={output} readOnly />
      </div>
    </ToolShell>
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
        'flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
        checked
          ? 'border-foreground/30 bg-accent font-medium'
          : 'border-input bg-background hover:bg-accent'
      )}
    >
      <span
        className={cn(
          'h-3 w-3 rounded-sm border',
          checked ? 'border-foreground bg-foreground' : 'border-muted-foreground/40'
        )}
      />
      {label}
    </button>
  )
}
