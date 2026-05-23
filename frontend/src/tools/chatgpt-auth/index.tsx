import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  HelpCircle,
  KeyRound,
  Sparkles,
  X,
} from 'lucide-react'
import { ToolShell } from '@/components/tool/ToolShell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { downloadText } from '@/lib/download'

import { meta } from './meta'
import {
  DEFAULT_TARGET_ID,
  TARGETS,
  TARGET_MAP,
  type TargetId,
} from './targets'
import {
  buildAllEntries,
  buildDownloadFilename,
  type ExportEntry,
} from './converters'
import { buildDemoSession } from './demo'

export default function ChatGPTAuthTool() {
  const [sessionText, setSessionText] = useState('')
  const [currentTargetId, setCurrentTargetId] = useState<TargetId>(DEFAULT_TARGET_ID)
  const [copied, setCopied] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const { entries, ctx, fatalError } = useMemo(() => {
    if (!sessionText.trim()) {
      return { entries: null, ctx: undefined, fatalError: undefined }
    }
    return buildAllEntries(sessionText)
  }, [sessionText])

  const currentEntry: ExportEntry | undefined = entries?.[currentTargetId]
  const isAvailable = (id: TargetId) => Boolean(entries?.[id] && !entries[id].error)

  // 当前 tab 失败时,自动切到首个可用的 tab,避免显示空预览
  useEffect(() => {
    if (!entries) return
    if (isAvailable(currentTargetId)) return
    const firstAvailable = TARGETS.find((t) => isAvailable(t.id))?.id
    if (firstAvailable && firstAvailable !== currentTargetId) {
      setCurrentTargetId(firstAvailable)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])

  const handleCopy = async () => {
    if (!currentEntry || currentEntry.error) return
    await navigator.clipboard.writeText(currentEntry.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = () => {
    if (!currentEntry || currentEntry.error) return
    const target = TARGET_MAP[currentEntry.id]
    const filename = buildDownloadFilename(currentEntry.id, target.filename, ctx?.email)
    downloadText(currentEntry.text, filename, 'application/json;charset=utf-8')
  }

  const handleLoadDemo = () => {
    setSessionText(buildDemoSession())
    setCurrentTargetId(DEFAULT_TARGET_ID)
  }

  const handleClear = () => {
    setSessionText('')
    setCurrentTargetId(DEFAULT_TARGET_ID)
  }

  const currentFilename = TARGET_MAP[currentTargetId].filename

  return (
    <ToolShell
      title={meta.title}
      description={meta.description}
      onLoadExample={handleLoadDemo}
      onClear={handleClear}
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHelp(true)}>
          <HelpCircle className="h-3.5 w-3.5" />
          如何获取 Session
        </Button>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        {/* 顶部:目标格式 segmented control */}
        <div className="inline-flex w-fit shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-1">
          {TARGETS.map((target) => {
            const entry = entries?.[target.id]
            const failed = entries !== null && !isAvailable(target.id)
            const active = target.id === currentTargetId && !failed
            return (
              <button
                key={target.id}
                type="button"
                onClick={() => !failed && setCurrentTargetId(target.id)}
                disabled={failed}
                title={entry?.error || target.description}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  active && 'bg-info text-info-foreground shadow-sm',
                  !active && !failed && 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  failed && 'cursor-not-allowed text-muted-foreground/50',
                )}
              >
                {target.label}
                {failed && <AlertCircle className="h-3 w-3 text-amber-500" />}
              </button>
            )
          })}
        </div>

        {/* 中间:左右双栏 */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          {/* 左:Session 输入 */}
          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />
                Session JSON
              </span>
              <span>{sessionText.length.toLocaleString()} 字符</span>
            </div>
            <textarea
              value={sessionText}
              onChange={(e) => setSessionText(e.target.value)}
              placeholder={`粘贴 chatgpt.com/api/auth/session 的 JSON...\n\n首次使用?点右上角"如何获取 Session"\n或点"示例"加载演示数据`}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-card p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-ring"
            />
            {fatalError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{fatalError}</span>
              </div>
            )}
            {ctx && !fatalError && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info/5 p-2.5 text-xs">
                <SessionFact label="邮箱" value={ctx.email} />
                <SessionFact label="计划" value={ctx.planType} />
                <SessionFact label="account_id" value={shorten(ctx.accountId)} />
                <SessionFact label="过期" value={formatExpire(ctx.expiresAt)} />
              </div>
            )}
          </section>

          {/* 右:预览 + 操作 */}
          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                预览 ·{' '}
                <span className="font-mono text-foreground">{currentFilename}</span>
              </span>
              {currentEntry?.error && (
                <span className="text-amber-500">{currentEntry.error}</span>
              )}
            </div>
            <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-xs leading-relaxed">
              {currentEntry?.text || (
                <span className="text-muted-foreground">
                  {entries ? '所选格式暂不可输出' : '请先粘贴 Session JSON 或点"示例"加载演示数据'}
                </span>
              )}
            </pre>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                disabled={!currentEntry || !!currentEntry.error}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-success" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    复制
                  </>
                )}
              </Button>
              <Button
                size="sm"
                onClick={handleDownload}
                disabled={!currentEntry || !!currentEntry.error}
              >
                <Download className="h-3.5 w-3.5" />
                下载 {currentFilename}
              </Button>
            </div>
          </section>
        </div>
      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </ToolShell>
  )
}

function SessionFact({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono text-foreground">{value}</span>
    </span>
  )
}

function shorten(value: string | undefined, head = 8, tail = 4): string | undefined {
  if (!value) return undefined
  if (value.length <= head + tail + 1) return value
  return value.slice(0, head) + '…' + value.slice(-tail)
}

function formatExpire(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return undefined
  const days = Math.floor((ms - Date.now()) / (24 * 60 * 60 * 1000))
  if (days < 0) return '已过期'
  if (days === 0) return '今天到期'
  if (days < 30) return `${days} 天后`
  return new Date(ms).toLocaleDateString()
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-info" />
            如何获取 Session JSON
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5 text-sm leading-relaxed">
          <p className="text-muted-foreground">
            ChatGPT 把登录态藏在 cookie 里,只有 chatgpt.com 域能读。
            最简单的拿到方式 —— 在已登录的浏览器里直接访问 API:
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              登录 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">https://chatgpt.com</code>
            </li>
            <li>
              新建标签页,地址栏粘贴并访问:
              <div className="mt-1.5 select-all rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
                https://chatgpt.com/api/auth/session
              </div>
            </li>
            <li>
              页面会显示一段 JSON,全选(<kbd className="rounded border border-border bg-muted px-1 text-[10px]">Ctrl/⌘ + A</kbd>) → 复制(
              <kbd className="rounded border border-border bg-muted px-1 text-[10px]">Ctrl/⌘ + C</kbd>)
            </li>
            <li>回到本工具,粘贴到左侧文本框,右侧会自动生成所有目标格式</li>
          </ol>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Session 等同于 ChatGPT 账号 cookie,<b>绝不要分享给他人</b>。
              本工具的所有处理都在本机完成,不会上传任何字节。
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
