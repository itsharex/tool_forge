import { useMemo, useRef, useState } from 'react'
import { AlertCircle, Database, Download, FolderOpen, Lock, Search } from 'lucide-react'
import { ToolShell } from '@/components/tool/ToolShell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { downloadText } from '@/lib/download'
import { useFileDrop } from '@/lib/useFileDrop'
import { useMmkvStore } from '@/stores/mmkv'
import { meta } from './meta'
import { parseMMKV } from './logic/parser'
import { decryptMMKV } from './logic/decrypt'
import {
  TYPE_ORDER,
  decodeAs,
  type MMKVType,
} from './logic/decoders'
import { ValueCell } from './components/ValueCell'
import { DetailModal, type DetailContext } from './components/DetailModal'
import { DecryptPanel } from './components/DecryptPanel'

const MAX_FILE_SIZE = 50 * 1024 * 1024

export default function MmkvTool() {
  const file = useMmkvStore((s) => s.file)
  const typesByKey = useMmkvStore((s) => s.typesByKey)
  const search = useMmkvStore((s) => s.search)
  const keyColWidth = useMmkvStore((s) => s.keyColWidth)
  const setFile = useMmkvStore((s) => s.setFile)
  const setTypesByKey = useMmkvStore((s) => s.setTypesByKey)
  const cycleTypeAction = useMmkvStore((s) => s.cycleType)
  const setSearch = useMmkvStore((s) => s.setSearch)
  const setKeyColWidth = useMmkvStore((s) => s.setKeyColWidth)
  const reset = useMmkvStore((s) => s.reset)

  const [error, setError] = useState('')
  const [detail, setDetail] = useState<DetailContext | null>(null)
  const [decryptOpen, setDecryptOpen] = useState(false)
  const [lastLoadedFile, setLastLoadedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const applyParsed = (
    name: string,
    size: number,
    parse: ReturnType<typeof parseMMKV>,
    encrypted = false
  ) => {
    const initial: Record<string, MMKVType[]> = {}
    for (const e of parse.entries) {
      initial[e.key] = e.values.map(() => 'hexstring' as MMKVType)
    }
    setFile({ name, size, parse, encrypted })
    setTypesByKey(initial)
  }

  const loadFile = async (f: File) => {
    setError('')
    setLastLoadedFile(f)
    if (f.size > MAX_FILE_SIZE) {
      setError(
        `文件过大（${(f.size / 1024 / 1024).toFixed(2)} MB），上限 ${MAX_FILE_SIZE / 1024 / 1024} MB`
      )
      return
    }
    try {
      const buf = await f.arrayBuffer()
      const parse = parseMMKV(new Uint8Array(buf))
      if (parse.entries.length === 0 && parse.removedCount === 0) {
        setError(
          '没有解析出任何 key。文件可能被 AES 加密，请用「加密打开」提供 .crc 和 AES key。'
        )
        setFile(null)
        return
      }
      applyParsed(f.name, f.size, parse, false)
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : '解析失败') +
          '。若为加密 MMKV，请点击「加密打开」。'
      )
      setFile(null)
    }
  }

  const decryptAndLoad = async (
    mmkvFile: File,
    crcFile: File,
    keyHex: string
  ) => {
    if (mmkvFile.size > MAX_FILE_SIZE) {
      throw new Error(
        `文件过大（${(mmkvFile.size / 1024 / 1024).toFixed(2)} MB），上限 ${MAX_FILE_SIZE / 1024 / 1024} MB`
      )
    }
    const [mmkvBuf, crcBuf] = await Promise.all([
      mmkvFile.arrayBuffer(),
      crcFile.arrayBuffer(),
    ])
    const plaintext = decryptMMKV(
      new Uint8Array(mmkvBuf),
      new Uint8Array(crcBuf),
      keyHex
    )
    const parse = parseMMKV(plaintext)
    if (parse.entries.length === 0 && parse.removedCount === 0) {
      throw new Error('解密后仍然没有解析出任何 key。可能是 AES key 错误')
    }
    applyParsed(mmkvFile.name, mmkvFile.size, parse, true)
    setError('')
    setDecryptOpen(false)
    setLastLoadedFile(mmkvFile)
  }

  const { dragOver, dragHandlers } = useFileDrop({
    binary: true,
    onLoad: (r) => {
      if (r.kind === 'binary') loadFile(r.file)
    },
    onError: (msg) => setError(msg),
  })

  const filteredEntries = useMemo(() => {
    if (!file) return []
    const q = search.trim().toLowerCase()
    if (!q) return file.parse.entries
    return file.parse.entries.filter((e) => e.key.toLowerCase().includes(q))
  }, [file, search])

  const getType = (key: string, index: number): MMKVType =>
    typesByKey[key]?.[index] ?? 'hexstring'

  const cycleType = (key: string, index: number) => {
    const cur = getType(key, index)
    const nextIdx = (TYPE_ORDER.indexOf(cur) + 1) % TYPE_ORDER.length
    cycleTypeAction(key, index, TYPE_ORDER[nextIdx])
  }

  const exportJson = () => {
    if (!file) return
    const out: Record<string, unknown> = {}
    for (const entry of file.parse.entries) {
      out[entry.key] = entry.values.map((v, i) => {
        const t = getType(entry.key, i)
        const r = decodeAs(v, t)
        return r.ok
          ? { type: t, value: serializable(r.raw) }
          : { type: t, error: r.reason }
      })
    }
    downloadText(
      JSON.stringify(out, null, 2),
      `${file.name}.json`,
      'application/json;charset=utf-8'
    )
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = keyColWidth
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(100, Math.min(700, startWidth + ev.clientX - startX))
      setKeyColWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <ToolShell
      title={meta.title}
      description={meta.description}
      onClear={() => {
        reset()
        setError('')
        setDetail(null)
        setDecryptOpen(false)
        setLastLoadedFile(null)
      }}
      actions={
        <div className="flex items-center gap-1.5">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            打开
          </Button>
          <Button
            variant={decryptOpen ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDecryptOpen((v) => !v)}
          >
            <Lock className="h-3.5 w-3.5" />
            加密打开
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={exportJson}
            disabled={!file}
          >
            <Download className="h-3.5 w-3.5" />
            导出 JSON
          </Button>
        </div>
      }
    >
      <div
        {...dragHandlers}
        className={cn(
          'relative flex h-full flex-col gap-3 rounded-lg transition',
          dragOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
        )}
      >
        {decryptOpen && (
          <DecryptPanel
            initialMmkvFile={lastLoadedFile}
            onCancel={() => setDecryptOpen(false)}
            onSubmit={decryptAndLoad}
          />
        )}

        {file ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-medium">{file.name}</span>
                {file.encrypted && (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <Lock className="h-3 w-3" />
                    已解密
                  </span>
                )}
                <span className="text-muted-foreground">
                  共 {file.parse.entries.length} 个 key
                  {file.parse.removedCount > 0 && (
                    <> · {file.parse.removedCount} 个删除标记</>
                  )}
                  {' · '}
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索 key"
                    spellCheck={false}
                    className="h-7 w-56 rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="flex-1 overflow-auto rounded-lg border border-border bg-card">
              <table className="w-full table-fixed border-separate border-spacing-0">
                <colgroup>
                  <col style={{ width: `${keyColWidth}px` }} />
                  <col />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-muted/60 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="relative border-b border-border px-3 py-2">
                      Key
                      {/* 拖拽句柄：宽 5px 更容易命中，hover 时显色 */}
                      <div
                        onMouseDown={startResize}
                        title="拖动调整 Key 列宽"
                        className="absolute right-[-2px] top-0 z-20 h-full w-[5px] cursor-col-resize bg-transparent hover:bg-primary/60"
                      />
                    </th>
                    <th className="border-b border-border px-3 py-2">Values</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={2}
                        className="px-4 py-8 text-center text-xs text-muted-foreground"
                      >
                        {search ? '没有匹配的 key' : '空 MMKV 文件'}
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map((entry) => (
                      <tr key={entry.key} className="align-top">
                        <td className="border-b border-border px-3 py-2 font-mono text-[12.5px]">
                          <div className="truncate" title={entry.key}>
                            {entry.key}
                          </div>
                          {entry.values.length > 1 && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {entry.values.length} 个历史值
                            </div>
                          )}
                        </td>
                        <td className="min-w-0 border-b border-border px-2 py-1.5">
                          <div className="space-y-1">
                            {entry.values.map((v, i) => (
                              <ValueCell
                                key={i}
                                bytes={v}
                                type={getType(entry.key, i)}
                                onCycle={() => cycleType(entry.key, i)}
                                onExpand={() =>
                                  setDetail({
                                    key: entry.key,
                                    index: i,
                                    total: entry.values.length,
                                    bytes: v,
                                    type: getType(entry.key, i),
                                  })
                                }
                              />
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState
            onPick={() => fileInputRef.current?.click()}
            error={error}
          />
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary">
            松开以加载文件
          </div>
        )}
      </div>

      {detail && <DetailModal ctx={detail} onClose={() => setDetail(null)} />}
    </ToolShell>
  )
}

function EmptyState({ onPick, error }: { onPick: () => void; error: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <Database className="h-12 w-12 text-muted-foreground" />
        <div className="space-y-1">
          <div className="text-sm font-medium">打开一个 MMKV 文件</div>
          <div className="text-xs text-muted-foreground">
            将 MMKV 文件拖到此处，或点击下方按钮选择（最大 50 MB）
          </div>
        </div>
        <Button onClick={onPick} size="sm">
          <FolderOpen className="h-3.5 w-3.5" />
          选择文件
        </Button>
        {error && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}
        <div className="mt-4 max-w-md space-y-1 text-left text-[11px] text-muted-foreground">
          <div className="font-medium text-foreground/80">基本使用</div>
          <div>· 支持未加密的 MMKV 文件（拖放 / 点击「打开」）</div>
          <div>· 同一个 key 的历史值会各自一行展示</div>
          <div>· 点击 value 左侧的类型徽章循环切换解释类型（颜色会变）</div>
          <div>· 点击 value 文本或右侧 expand 图标弹出详情，可复制任意类型的解码</div>
          <div>· 拖动 Key / Values 列之间的分隔线可调整列宽</div>
          <div>· 切换到别的工具再回来，文件不会丢（刷新页面会丢）</div>

          <div className="mt-3 font-medium text-foreground/80">加密文件（AES-128-CFB）</div>
          <div>
            · 点击工具栏「<Lock className="inline h-3 w-3" /> 加密打开」展开解密面板
          </div>
          <div>· 同时选择加密的 MMKV 文件和配对的 .crc 文件</div>
          <div>· 输入 AES key 的十六进制（不足 16 字节自动补 0，多余截断）</div>
          <div>
            · IV 取自 .crc 文件的第 12~27 字节，工具会自动处理；头 4 字节不加密
          </div>
          <div>· 解密后按正常 MMKV 流程解析，成功后状态栏会有「已解密」标记</div>
        </div>
      </div>
    </div>
  )
}

function serializable(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Uint8Array) {
    let s = ''
    for (const b of v) s += b.toString(16).padStart(2, '0')
    return s
  }
  return v
}
