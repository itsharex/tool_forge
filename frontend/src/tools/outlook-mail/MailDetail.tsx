import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, Key, Loader2, Maximize2, ShieldAlert, X } from 'lucide-react'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'
import { cn } from '@/lib/utils'
import { avatarLetter, avatarStyle } from './avatar'
import { outlookAPI } from './api'
import type { ExtractResult, Mail, MailDetail as MailDetailT } from './types'

export function MailDetail({
  accountEmail,
  accountID,
  mail,
}: {
  accountEmail: string
  accountID: string
  mail: Mail | null
}) {
  const [detail, setDetail] = useState<MailDetailT | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [extract, setExtract] = useState<ExtractResult | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    setDetail(null)
    setError('')
    setExtract(null)
    if (!mail) return
    let cancelled = false
    setLoading(true)
    void outlookAPI
      .getMail(accountID, mail.folder, mail.id)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        // 拿到详情后自动跑一次提取
        void runExtractInline(d)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountID, mail?.id, mail?.folder])

  const runExtractInline = async (d: MailDetailT) => {
    setExtracting(true)
    try {
      const r = await outlookAPI.extractText(d.body_text || stripHTML(d.body_html))
      setExtract(r)
    } catch (e) {
      console.warn(e)
    } finally {
      setExtracting(false)
    }
  }

  if (!mail) {
    return (
      <section className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        <div className="text-center">
          <div className="text-sm">选择一封邮件查看详情</div>
          <div className="mt-1 text-[11px]">支持验证码提取 / 链接打开 / 全屏查看</div>
        </div>
      </section>
    )
  }

  const seed = mail.from || mail.from_name || mail.subject
  return (
    <section className="flex flex-1 flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b border-border p-4">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            avatarStyle(seed),
          )}
        >
          {avatarLetter(seed)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{mail.subject || '(无主题)'}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-foreground/80">
              {mail.from_name || mail.from}{' '}
              {mail.from_name && (
                <span className="text-muted-foreground">&lt;{mail.from}&gt;</span>
              )}
            </span>
            <span className="text-muted-foreground">→ {accountEmail}</span>
            <span className="text-muted-foreground">{formatTime(mail.received)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="全屏查看"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </header>

      {/* 提取栏 */}
      <ExtractBar result={extract} loading={extracting} />

      {loading && (
        <div className="flex items-center justify-center p-8 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 读取邮件中...
        </div>
      )}
      {error && (
        <div className="m-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {detail && !loading && !error && (
        <div className="min-h-0 flex-1 overflow-auto">
          <MailBody detail={detail} />
        </div>
      )}

      {fullscreen && detail && (
        <FullscreenModal detail={detail} accountEmail={accountEmail} onClose={() => setFullscreen(false)} />
      )}
    </section>
  )
}

function ExtractBar({ result, loading }: { result: ExtractResult | null; loading: boolean }) {
  const [copied, setCopied] = useState(false)
  if (!result && !loading) return null
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-info/5 px-4 py-2 text-xs">
      <Key className="h-3.5 w-3.5 text-info" />
      <span className="text-muted-foreground">提取:</span>
      {loading && <Loader2 className="h-3 w-3 animate-spin text-info" />}
      {result?.code && (
        <button
          type="button"
          onClick={() => copy(result.code!)}
          className="inline-flex items-center gap-1 rounded-md border border-info/40 bg-info/10 px-2 py-1 font-mono text-sm font-semibold text-info hover:bg-info/20"
        >
          {result.code}
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      )}
      {result?.links?.slice(0, 3).map((l, i) => (
        <button
          key={i}
          type="button"
          onClick={() => BrowserOpenURL(l)}
          className="inline-flex max-w-[280px] items-center gap-1 truncate rounded-md border border-border px-2 py-1 text-info hover:bg-accent"
          title={l}
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{l}</span>
        </button>
      ))}
      {!loading && !result?.code && !result?.links?.length && (
        <span className="text-muted-foreground">没有找到验证码或链接</span>
      )}
    </div>
  )
}

function MailBody({ detail }: { detail: MailDetailT }) {
  if (detail.body_html) {
    // HTML 邮件:沙箱 iframe 渲染,scripts 被禁止
    const html = sanitizeHTML(detail.body_html)
    return (
      <iframe
        title="邮件正文"
        srcDoc={html}
        sandbox=""
        className="h-full w-full"
        style={{ minHeight: 480, border: 0 }}
      />
    )
  }
  if (detail.body_text) {
    return (
      <pre className="whitespace-pre-wrap p-4 font-sans text-sm leading-relaxed text-foreground">
        {detail.body_text}
      </pre>
    )
  }
  return (
    <div className="p-4 text-xs text-muted-foreground">邮件没有正文内容</div>
  )
}

function FullscreenModal({
  detail,
  accountEmail,
  onClose,
}: {
  detail: MailDetailT
  accountEmail: string
  onClose: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{detail.subject}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {detail.from_name || detail.from} → {accountEmail}
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <MailBody detail={detail} />
      </div>
    </div>,
    document.body,
  )
}

// sanitizeHTML 简单清洗:去 <script>、<iframe>、on* 事件属性。
// iframe sandbox="" 已经禁止脚本,这里只是 defense-in-depth。
function sanitizeHTML(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gis, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
}

function stripHTML(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gis, ' ')
    .replace(/<script[^>]*>.*?<\/script>/gis, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
}

function formatTime(s: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getDate()
    .toString()
    .padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`
}
