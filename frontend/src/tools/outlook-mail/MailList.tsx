import { useCallback, useEffect, useRef, useState } from 'react'
import { Inbox, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { avatarLetter, avatarStyle } from './avatar'
import { outlookAPI } from './api'
import type { FolderView, Mail } from './types'

export function MailList({
  accountID,
  folder,
  selectedMailID,
  onSelectMail,
  onChangeFolder,
  reloadToken,
}: {
  accountID: string
  folder: FolderView
  selectedMailID: string
  onSelectMail: (m: Mail) => void
  onChangeFolder: (f: FolderView) => void
  reloadToken: number
}) {
  const [mails, setMails] = useState<Mail[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)

  const containerRef = useRef<HTMLUListElement | null>(null)

  const load = useCallback(
    async (p: number, append: boolean) => {
      if (!accountID) {
        setMails([])
        setTotal(0)
        setHasMore(false)
        return
      }
      setLoading(true)
      setError('')
      try {
        if (folder === 'all') {
          // "全部" = 收件箱 + 垃圾邮件,并发拉取后按时间倒序合并
          const [a, b] = await Promise.all([
            outlookAPI.listMails(accountID, 'inbox', p, 20),
            outlookAPI.listMails(accountID, 'junkemail', p, 20),
          ])
          const merged = [...(a.mails ?? []), ...(b.mails ?? [])].sort((m1, m2) =>
            m2.received.localeCompare(m1.received),
          )
          setTotal((a.total ?? 0) + (b.total ?? 0))
          setHasMore(!!a.has_more || !!b.has_more)
          setPage(p)
          if (append) setMails((prev) => [...prev, ...merged])
          else setMails(merged)
        } else {
          const res = await outlookAPI.listMails(accountID, folder, p, 20)
          setTotal(res.total)
          setHasMore(res.has_more)
          setPage(p)
          if (append) setMails((prev) => [...prev, ...(res.mails ?? [])])
          else setMails(res.mails ?? [])
        }
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    },
    [accountID, folder],
  )

  useEffect(() => {
    void load(1, false)
    // 重置滚动
    if (containerRef.current) containerRef.current.scrollTop = 0
  }, [load, reloadToken])

  const onScroll = (e: React.UIEvent<HTMLUListElement>) => {
    if (loading || !hasMore) return
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      void load(page + 1, true)
    }
  }

  return (
    <section className="flex w-[360px] shrink-0 flex-col border-r border-border">
      <header className="flex h-10 shrink-0 items-center justify-between gap-1 border-b border-border px-2">
        <div className="flex min-w-0 gap-1">
          <FolderTab active={folder === 'all'} onClick={() => onChangeFolder('all')}>
            全部
          </FolderTab>
          <FolderTab active={folder === 'inbox'} onClick={() => onChangeFolder('inbox')}>
            收件箱
          </FolderTab>
          <FolderTab active={folder === 'junkemail'} onClick={() => onChangeFolder('junkemail')}>
            垃圾邮件
          </FolderTab>
        </div>
        <button
          type="button"
          onClick={() => load(1, false)}
          disabled={loading || !accountID}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-all hover:border-info/60 hover:bg-info/5 hover:text-info disabled:cursor-not-allowed disabled:opacity-50"
          title="刷新邮件列表"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span>刷新</span>
          {total > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
              {total}
            </span>
          )}
        </button>
      </header>

      {!accountID && (
        <div className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
          <span>请先在左侧选择一个邮箱账号</span>
        </div>
      )}

      {accountID && error && (
        <div className="m-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="break-all">
            <div className="font-semibold">读取失败</div>
            <div>{error}</div>
          </div>
        </div>
      )}

      {accountID && (
        <ul
          ref={containerRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto"
        >
          {mails.length === 0 && !loading ? (
            <li className="flex flex-col items-center gap-2 p-8 text-xs text-muted-foreground">
              <Inbox className="h-6 w-6" />
              <span>没有邮件</span>
            </li>
          ) : (
            mails.map((m) => (
              <MailItem
                key={m.id}
                mail={m}
                active={m.id === selectedMailID}
                onClick={() => onSelectMail(m)}
              />
            ))
          )}
          {loading && mails.length > 0 && (
            <li className="flex justify-center p-3 text-xs text-muted-foreground">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> 加载中...
            </li>
          )}
          {!hasMore && mails.length > 0 && !loading && (
            <li className="py-3 text-center text-[10px] text-muted-foreground">— 已到底 —</li>
          )}
        </ul>
      )}
    </section>
  )
}

function FolderTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors',
        active
          ? 'bg-info/15 text-info'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function MailItem({
  mail,
  active,
  onClick,
}: {
  mail: Mail
  active: boolean
  onClick: () => void
}) {
  const seed = mail.from || mail.from_name || mail.subject
  const display = mail.from_name || mail.from || '未知发件人'
  return (
    <li
      onClick={onClick}
      className={cn(
        'flex cursor-pointer gap-2 border-b border-border/40 px-2 py-2 transition-colors',
        active ? 'bg-info/10' : 'hover:bg-accent/40',
        !mail.is_read && 'font-medium',
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
          avatarStyle(seed),
        )}
      >
        {avatarLetter(seed)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1 text-xs">
          <span className="truncate text-foreground/90">{display}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatTime(mail.received)}
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs text-foreground">{mail.subject || '(无主题)'}</div>
        {mail.body_preview && (
          <div className="mt-0.5 line-clamp-2 text-[11px] font-normal text-muted-foreground">
            {mail.body_preview}
          </div>
        )}
      </div>
    </li>
  )
}

function formatTime(s: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  if (sameYear) {
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getDate()
    .toString()
    .padStart(2, '0')}`
}
