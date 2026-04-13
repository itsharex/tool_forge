import { useCallback, useRef, useState } from 'react'
import { AlertCircle, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useFileDrop } from '@/lib/useFileDrop'
import { meta } from './meta'
import { Toolbar } from './components/Toolbar'
import { HexView } from './components/HexView'
import { Inspector } from './components/Inspector'
import { StatusBar } from './components/StatusBar'
import type { EncodingId } from './logic/encodings'
import type { Radix } from './logic/format'

const MAX_FILE_SIZE = 50 * 1024 * 1024

export default function HexEditor() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [fileName, setFileName] = useState('')
  const [cursor, setCursor] = useState(0)
  const [radix, setRadix] = useState<Radix>('hex')
  const [encoding, setEncoding] = useState<EncodingId>('ascii')
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollToOffsetRef = useRef<((off: number) => void) | null>(null)

  const loadFile = useCallback(async (file: File) => {
    setError('')
    if (file.size > MAX_FILE_SIZE) {
      setError(
        `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），上限 ${MAX_FILE_SIZE / 1024 / 1024} MB`
      )
      return
    }
    try {
      const buf = await file.arrayBuffer()
      setBytes(new Uint8Array(buf))
      setFileName(file.name)
      setCursor(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取文件失败')
    }
  }, [])

  const { dragOver, dragHandlers } = useFileDrop({
    binary: true,
    onLoad: (r) => {
      if (r.kind === 'binary') {
        // 绕开 useFileDrop 的硬上限，自己控制阈值
        const file = r.file
        loadFile(file)
      }
    },
    onError: (msg) => setError(msg),
  })

  const pickFile = () => fileInputRef.current?.click()

  return (
    <div
      className="flex h-full flex-col bg-background"
      {...dragHandlers}
    >
      <Toolbar
        hasFile={!!bytes}
        radix={radix}
        encoding={encoding}
        onRadixChange={setRadix}
        onEncodingChange={setEncoding}
        onPickFile={pickFile}
        onJumpTo={(off) => {
          setCursor(off)
          scrollToOffsetRef.current?.(off)
        }}
        total={bytes?.length ?? 0}
      />

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) loadFile(f)
          e.target.value = ''
        }}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {bytes ? (
          <>
            <div className="min-w-0 flex-1">
              <HexView
                bytes={bytes}
                cursor={cursor}
                onCursorChange={setCursor}
                radix={radix}
                encoding={encoding}
                onScrollToOffset={(fn) => {
                  scrollToOffsetRef.current = fn
                }}
              />
            </div>
            <Inspector
              bytes={bytes}
              cursor={cursor}
              collapsed={inspectorCollapsed}
              onToggle={() => setInspectorCollapsed((v) => !v)}
            />
          </>
        ) : (
          <EmptyState onPick={pickFile} error={error} />
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/10 text-sm font-medium text-primary">
            松开以加载文件
          </div>
        )}
      </div>

      <StatusBar
        fileName={fileName}
        total={bytes?.length ?? 0}
        cursor={cursor}
        encoding={encoding}
      />

      {/* 加载中 / 错误覆盖层 */}
      {error && bytes && (
        <div className="absolute right-3 top-12 max-w-sm rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive shadow">
          {error}
        </div>
      )}

      {/* 简单的元信息条（隐藏） */}
      <span className="hidden">{meta.title}</span>
    </div>
  )
}

function EmptyState({ onPick, error }: { onPick: () => void; error: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <FolderOpen className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <div className="text-sm font-medium">打开一个二进制文件</div>
          <div className="text-xs text-muted-foreground">
            点击「打开」或将文件拖到此处（最大 50 MB）
          </div>
        </div>
        <Button onClick={onPick} size="sm">
          <FolderOpen className="h-3.5 w-3.5" />
          选择文件
        </Button>
        {error && (
          <div
            className={cn(
              'mt-2 flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive'
            )}
          >
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
