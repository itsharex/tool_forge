import { useRef, useState } from 'react'
import { FolderOpen, Lock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  onSubmit: (mmkvFile: File, crcFile: File, keyHex: string) => Promise<void>
  onCancel: () => void
  /** 外部注入的错误（解密/解析失败） */
  externalError?: string
  /** 若已加载一个文件，允许直接用它（省得再选一遍） */
  initialMmkvFile?: File | null
}

export function DecryptPanel({
  onSubmit,
  onCancel,
  externalError,
  initialMmkvFile,
}: Props) {
  const [mmkvFile, setMmkvFile] = useState<File | null>(initialMmkvFile ?? null)
  const [crcFile, setCrcFile] = useState<File | null>(null)
  const [keyHex, setKeyHex] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const mmkvInputRef = useRef<HTMLInputElement>(null)
  const crcInputRef = useRef<HTMLInputElement>(null)

  const ready = !!mmkvFile && !!crcFile && keyHex.trim().length > 0 && !busy

  const submit = async () => {
    if (!mmkvFile || !crcFile) return
    setBusy(true)
    setErr('')
    try {
      await onSubmit(mmkvFile, crcFile, keyHex.trim())
    } catch (e) {
      setErr(e instanceof Error ? e.message : '解密失败')
    } finally {
      setBusy(false)
    }
  }

  const combinedError = err || externalError || ''

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">加密 MMKV（AES-128-CFB）</span>
        </div>
        <button
          onClick={onCancel}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        <FilePickerRow
          label="加密 MMKV 文件"
          file={mmkvFile}
          inputRef={mmkvInputRef}
          onPick={() => mmkvInputRef.current?.click()}
          onChange={setMmkvFile}
        />
        <FilePickerRow
          label=".crc 文件"
          file={crcFile}
          inputRef={crcInputRef}
          onPick={() => crcInputRef.current?.click()}
          onChange={setCrcFile}
          hint="IV 取自 .crc 文件的第 12~27 字节"
        />
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            AES key（十六进制）
          </label>
          <input
            value={keyHex}
            onChange={(e) => setKeyHex(e.target.value)}
            placeholder="例如 1A2B3C4D5E6F...（不足 32 位自动补零，多余截断）"
            spellCheck={false}
            className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {combinedError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {combinedError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={!ready}>
            {busy ? '解密中…' : '解密并打开'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function FilePickerRow({
  label,
  file,
  inputRef,
  onPick,
  onChange,
  hint,
}: {
  label: string
  file: File | null
  inputRef: React.RefObject<HTMLInputElement>
  onPick: () => void
  onChange: (f: File | null) => void
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            onChange(f ?? null)
            e.target.value = ''
          }}
        />
        <Button variant="outline" size="sm" onClick={onPick}>
          <FolderOpen className="h-3.5 w-3.5" />
          选择
        </Button>
        <span
          className={cn(
            'flex-1 truncate font-mono text-xs',
            file ? 'text-foreground' : 'text-muted-foreground'
          )}
          title={file?.name ?? ''}
        >
          {file ? `${file.name} (${file.size} B)` : '未选择'}
        </span>
      </div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  )
}
