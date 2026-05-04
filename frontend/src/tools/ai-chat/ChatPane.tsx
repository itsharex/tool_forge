import { useEffect, useRef, useState } from 'react'
import {
  Send,
  Square,
  Bot,
  User,
  Copy,
  Check,
  Sparkles,
  ChevronDown,
  Brain,
  RotateCcw,
  Pencil,
  Settings2,
  Eraser,
  Trash2,
  X,
} from 'lucide-react'
import {
  DeleteAIChatMessage,
  EditAndResendAIChat,
  GetAIConversation,
  InsertAIClearMarker,
  ListAIProviders,
  RegenerateAILastChat,
  SendAIChat,
  StopAIChat,
  UpdateAIConversationMeta,
  UpdateAIConversationModel,
} from '../../../wailsjs/go/main/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import {
  EV_CHUNK_PREFIX,
  EV_THINKING_PREFIX,
  EV_DONE_PREFIX,
  EV_ERROR_PREFIX,
  type Conversation,
  type Message,
  type Provider,
} from './types'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { MarkdownPreview } from '@/components/tool/MarkdownPreview'
import { ChatModelPicker } from './ChatModelPicker'
import { ProviderAvatar } from './ProviderAvatar'
import { ConversationDialog } from './ConversationDialog'
import { cn } from '@/lib/utils'

interface Props {
  conversationId: string
  onTitleChange: () => void
}

const SUGGESTIONS = [
  '帮我用 Go 写一个简易 HTTP 服务器',
  '用一句话解释什么是 Wails',
  '把下面这段 SQL 改成 PostgreSQL 兼容写法',
  '帮我润色一段产品介绍文案',
]

export function ChatPane({ conversationId, onTitleChange }: Props) {
  const dialog = useConfirm()
  const [conv, setConv] = useState<Conversation | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [systemOpen, setSystemOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const reloadProviders = async () => {
    const list = ((await ListAIProviders()) ?? []) as unknown as Provider[]
    setProviders(list)
  }

  const load = async () => {
    const r = (await GetAIConversation(conversationId)) as any
    const c = pickFirst<Conversation>(r)
    if (c?.id) setConv(c)
  }

  useEffect(() => {
    setConv(null)
    void load()
    void reloadProviders()
  }, [conversationId])

  // 自动跟随到底部 — 但用户主动往上滑就停;再滑回底部就恢复跟随
  const [stickToBottom, setStickToBottom] = useState(true)
  // 区分"用户滚动"与"我们 setScrollTop 引起的滚动",后者不应改变 stick 状态
  const programmaticScrollRef = useRef(false)

  const lastMsg = conv?.messages[conv.messages.length - 1]
  const lastLen = (lastMsg?.content.length ?? 0) + (lastMsg?.thinking?.length ?? 0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottom) return
    programmaticScrollRef.current = true
    el.scrollTop = el.scrollHeight
    // 下一帧解锁,避免误把这次滚动当成用户行为
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
  }, [conv?.messages.length, lastLen, stickToBottom])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (programmaticScrollRef.current) return
    const el = e.currentTarget
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setStickToBottom(distanceFromBottom < 40)
  }

  const jumpToBottom = () => {
    setStickToBottom(true)
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // 订阅事件:chunk / done / error;用 EventsOn 返回的 cancel 函数,避免误伤同名监听
  useEffect(() => {
    if (!conversationId) return
    const offChunk = EventsOn(EV_CHUNK_PREFIX + conversationId, (delta: string) => {
      if (!delta) return
      setConv((prev) => {
        if (!prev) return prev
        const msgs = [...prev.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: last.content + delta }
          return { ...prev, messages: msgs }
        }
        return prev
      })
    })
    const offThinking = EventsOn(EV_THINKING_PREFIX + conversationId, (delta: string) => {
      if (!delta) return
      setConv((prev) => {
        if (!prev) return prev
        const msgs = [...prev.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') {
          msgs[msgs.length - 1] = {
            ...last,
            thinking: (last.thinking ?? '') + delta,
          }
          return { ...prev, messages: msgs }
        }
        return prev
      })
    })
    const offDone = EventsOn(EV_DONE_PREFIX + conversationId, (final: string) => {
      setStreaming(false)
      setConv((prev) => {
        if (!prev) return prev
        const msgs = [...prev.messages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') {
          // final 是后端累计的完整内容;保险起见以它为准
          msgs[msgs.length - 1] = { ...last, content: final || last.content }
          return { ...prev, messages: msgs }
        }
        return prev
      })
      onTitleChange()
    })
    const offError = EventsOn(EV_ERROR_PREFIX + conversationId, (err: string) => {
      setStreaming(false)
      void dialog({ title: '请求失败', message: err || '未知错误', confirmLabel: '知道了' })
      void load()
    })
    return () => {
      offChunk()
      offThinking()
      offDone()
      offError()
    }
  }, [conversationId])

  const provider = providers.find((p) => p.id === conv?.providerId) ?? null

  const onSend = async (override?: string) => {
    const content = (override ?? draft).trim()
    if (!content || streaming || !conv) return
    setDraft('')
    setStreaming(true)

    // 乐观更新:先把 user + assistant 占位放进本地状态,
    // 这样后端 goroutine 立刻发的 chunk 一定能找到对的 last 消息(避免 race)
    const now = Date.now()
    const tmpUser: Message = {
      id: 'tmp-u-' + now,
      role: 'user',
      content,
      createdAt: now,
    }
    const tmpAsst: Message = {
      id: 'tmp-a-' + now,
      role: 'assistant',
      content: '',
      thinking: '',
      model: conv.modelId,
      createdAt: now + 1,
    }
    setConv((prev) =>
      prev ? { ...prev, messages: [...prev.messages, tmpUser, tmpAsst] } : prev,
    )

    const r = (await SendAIChat(conv.id, content)) as any
    const err = pickSecond(r)
    if (err) {
      setStreaming(false)
      // 回滚乐观更新
      setConv((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.filter(
                (m) => m.id !== tmpUser.id && m.id !== tmpAsst.id,
              ),
            }
          : prev,
      )
      await dialog({ title: '发送失败', message: err, confirmLabel: '知道了' })
      return
    }
    // 不 setConv(next) — 保留乐观状态,避免覆盖期间到达的 chunk;
    // 流结束时 onDone 会用最终内容兜底纠正
    onTitleChange()
  }

  const onStop = async () => {
    if (!conv) return
    await StopAIChat(conv.id)
  }

  const onEditResend = async (msgId: string, newContent: string) => {
    if (!conv || streaming) return
    setStreaming(true)
    // 乐观更新:截断该消息之后的所有,改写其内容,并加占位 assistant
    setConv((prev) => {
      if (!prev) return prev
      const idx = prev.messages.findIndex((m) => m.id === msgId)
      if (idx < 0) return prev
      const kept = prev.messages.slice(0, idx + 1).map((m) =>
        m.id === msgId ? { ...m, content: newContent } : m,
      )
      const tmpAsst: Message = {
        id: 'tmp-edit-' + Date.now(),
        role: 'assistant',
        content: '',
        thinking: '',
        model: prev.modelId,
        createdAt: Date.now(),
      }
      return { ...prev, messages: [...kept, tmpAsst] }
    })
    const r = (await EditAndResendAIChat(conv.id, msgId, newContent)) as any
    const err = pickSecond(r)
    if (err) {
      setStreaming(false)
      await dialog({ title: '重新发送失败', message: err, confirmLabel: '知道了' })
      void load()
    }
  }

  const onRegenerate = async () => {
    if (!conv || streaming) return
    setStreaming(true)
    // 乐观更新:把最后一条 assistant 的 content / thinking 清空,前端立刻进入"思考中"
    setConv((prev) => {
      if (!prev) return prev
      const msgs = [...prev.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: '', thinking: '', model: prev.modelId }
      }
      return { ...prev, messages: msgs }
    })
    const r = (await RegenerateAILastChat(conv.id)) as any
    const err = pickSecond(r)
    if (err) {
      setStreaming(false)
      await dialog({ title: '重新生成失败', message: err, confirmLabel: '知道了' })
      void load()
    }
  }

  const onSaveMeta = async (draft: { title: string; system: string; contextCount: number }) => {
    if (!conv) return
    const err =
      ((await UpdateAIConversationMeta(
        conv.id,
        draft.title || conv.title,
        draft.system,
        draft.contextCount,
      )) as string) || ''
    if (err) {
      await dialog({ title: '保存失败', message: err, confirmLabel: '知道了' })
      return
    }
    setConv((prev) =>
      prev
        ? {
            ...prev,
            title: draft.title || prev.title,
            system: draft.system,
            contextCount: draft.contextCount,
          }
        : prev,
    )
    setSystemOpen(false)
    onTitleChange()
  }

  const onDeleteMessage = async (msgId: string) => {
    if (!conv) return
    const ok = await dialog({
      title: '删除消息',
      message: '确认删除这条消息?该操作不可撤销。',
      danger: true,
      confirmLabel: '删除',
    })
    if (!ok) return
    // 乐观删除
    setConv((prev) =>
      prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== msgId) } : prev,
    )
    const err = ((await DeleteAIChatMessage(conv.id, msgId)) as string) || ''
    if (err) {
      await dialog({ title: '删除失败', message: err, confirmLabel: '知道了' })
      void load() // 失败时回查后端真实状态
    }
  }

  const onClearContext = async () => {
    if (!conv || streaming) return
    const err = ((await InsertAIClearMarker(conv.id)) as string) || ''
    if (err) {
      await dialog({ title: '操作失败', message: err, confirmLabel: '知道了' })
      return
    }
    void load()
  }

  const onPickModel = async (providerId: string, modelId: string) => {
    if (!conv) return
    setPickerOpen(false)
    await UpdateAIConversationModel(conv.id, providerId, modelId)
    setConv({ ...conv, providerId, modelId })
    textareaRef.current?.focus()
  }

  if (!conv) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  const visibleMessages = conv.messages.filter((m) => m.role !== 'system')
  const isEmpty = visibleMessages.length === 0
  const lastVisible = visibleMessages[visibleMessages.length - 1]

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{conv.title}</h3>
        <button
          type="button"
          onClick={() => setSystemOpen(true)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
            conv.system
              ? 'border-info/40 bg-info/10 text-info'
              : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
          title="编辑会话(标题/系统提示/上下文)"
        >
          <Settings2 className="h-3.5 w-3.5" />
          会话设置
          {conv.system && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-info" />}
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-auto bg-background"
      >
        {isEmpty ? (
          <WelcomeScreen
            providerName={provider?.name ?? ''}
            modelId={conv.modelId}
            onPick={(s) => {
              setDraft(s)
              textareaRef.current?.focus()
            }}
          />
        ) : (
          <ul className="mx-auto max-w-3xl space-y-6 px-4 py-6">
            {visibleMessages.map((m) => {
              if (m.role === 'clear') {
                return (
                  <ClearDivider
                    key={m.id}
                    onDelete={!streaming ? () => void onDeleteMessage(m.id) : undefined}
                  />
                )
              }
              const isLast = m === lastVisible
              const isAssistant = m.role === 'assistant'
              const canMutate = !streaming && !(streaming && isLast && isAssistant)
              return (
                <MessageItem
                  key={m.id}
                  message={m}
                  fallbackModel={conv.modelId}
                  streaming={streaming && isLast && isAssistant}
                  onRegenerate={
                    isLast && isAssistant && !streaming ? onRegenerate : undefined
                  }
                  onEditResend={
                    m.role === 'user' && !streaming
                      ? (newContent) => void onEditResend(m.id, newContent)
                      : undefined
                  }
                  onDelete={canMutate ? () => void onDeleteMessage(m.id) : undefined}
                />
              )
            })}
          </ul>
        )}
      </div>

      {!stickToBottom && !isEmpty && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="pointer-events-auto absolute bottom-[148px] left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs text-muted-foreground shadow-lg transition-colors hover:bg-secondary hover:text-foreground"
          title="滚动到最新"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          回到最新
        </button>
      )}

      <footer className="shrink-0 border-t border-border bg-card">
        <div className="mx-auto max-w-3xl p-3">
          {!isEmpty && !streaming && (
            <div className="mb-2 flex items-center justify-end">
              <button
                type="button"
                onClick={() => void onClearContext()}
                className="flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                title="插入分隔线,后续问答不再带上之前的上下文"
              >
                <Eraser className="h-3 w-3" />
                清除上下文
              </button>
            </div>
          )}
          <div className="rounded-xl border border-input bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void onSend()
                }
              }}
              placeholder="发条消息(Enter 发送 · Shift+Enter 换行)"
              rows={3}
              className="block max-h-[240px] w-full resize-none rounded-t-xl bg-transparent px-3 pt-3 text-sm outline-none"
            />

            <div className="flex items-center justify-between gap-2 border-t border-border/50 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {provider ? (
                  <ProviderAvatar logo={provider.logo} name={provider.name} size={18} />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span className="max-w-[260px] truncate font-medium">
                  {provider?.name ?? '未配置'} · {conv.modelId || '未选模型'}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {streaming ? (
                <Button onClick={onStop} variant="outline" size="sm">
                  <Square className="h-3 w-3" />
                  停止
                </Button>
              ) : (
                <Button onClick={() => void onSend()} disabled={!draft.trim()} size="sm">
                  <Send className="h-3 w-3" />
                  发送
                </Button>
              )}
            </div>
          </div>
        </div>
      </footer>

      {pickerOpen && (
        <ChatModelPicker
          current={{ providerId: conv.providerId, modelId: conv.modelId }}
          onClose={() => setPickerOpen(false)}
          onPick={(pid, mid) => void onPickModel(pid, mid)}
        />
      )}

      {systemOpen && (
        <ConversationDialog
          mode="edit"
          initial={{
            title: conv.title,
            system: conv.system ?? '',
            contextCount: conv.contextCount ?? 0,
          }}
          onClose={() => setSystemOpen(false)}
          onSave={(d) => void onSaveMeta(d)}
        />
      )}
    </div>
  )
}

function WelcomeScreen({
  providerName,
  modelId,
  onPick,
}: {
  providerName: string
  modelId: string
  onPick: (s: string) => void
}) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-info/15 text-info">
        <Sparkles className="h-7 w-7" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">今天我能帮你做什么?</h2>
        <p className="text-xs text-muted-foreground">
          {providerName ? `${providerName} · ${modelId}` : '请先在底栏选择模型'}
        </p>
      </div>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-lg border border-border bg-card p-3 text-left text-xs text-muted-foreground transition-colors hover:border-info/50 hover:bg-info/5 hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function ClearDivider({ onDelete }: { onDelete?: () => void }) {
  return (
    <li className="group/clear flex items-center gap-3 py-1 text-[11px] text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <Eraser className="h-3 w-3" />
      <span>上下文已清除 · 之后的问答不再带上之前的对话</span>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="移除分隔线"
          className="hidden h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground group-hover/clear:flex"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <div className="h-px flex-1 bg-border" />
    </li>
  )
}

function MessageItem({
  message,
  fallbackModel,
  streaming,
  onRegenerate,
  onEditResend,
  onDelete,
}: {
  message: Message
  fallbackModel: string
  streaming?: boolean
  onRegenerate?: () => void
  onEditResend?: (newContent: string) => void
  onDelete?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const isUser = message.role === 'user'
  const label = isUser ? '你' : message.model || fallbackModel || '助手'

  const onCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const startEdit = () => {
    setDraft(message.content)
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    setDraft(message.content)
  }
  const submitEdit = () => {
    const next = draft.trim()
    if (!next || !onEditResend) return
    if (next === message.content.trim()) {
      setEditing(false)
      return
    }
    onEditResend(next)
    setEditing(false)
  }

  return (
    <li className="group/msg flex gap-3">
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-info/15 text-info' : 'bg-success/15 text-success',
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-xs font-medium text-muted-foreground" title={label}>
          {label}
        </div>

        {!isUser && message.thinking && (
          <ThinkingBlock content={message.thinking} streaming={!!streaming && !message.content} />
        )}

        <div className="min-w-0 text-sm leading-relaxed">
          {isUser ? (
            editing ? (
              <div className="rounded-lg border border-info/50 bg-info/5">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      submitEdit()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelEdit()
                    }
                  }}
                  rows={Math.min(8, Math.max(2, draft.split('\n').length))}
                  className="block w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm outline-none"
                />
                <div className="flex items-center justify-end gap-2 border-t border-info/20 px-2 py-1.5 text-[11px]">
                  <span className="mr-auto text-muted-foreground">
                    Ctrl/⌘+Enter 重发 · Esc 取消
                  </span>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={submitEdit}
                    disabled={!draft.trim()}
                    className="rounded-md bg-info px-2.5 py-1 font-medium text-info-foreground transition-colors hover:bg-info/90 disabled:opacity-50"
                  >
                    重新发送
                  </button>
                </div>
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words rounded-lg bg-info/5 px-3 py-2">
                {message.content}
              </div>
            )
          ) : message.content ? (
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <MarkdownPreview value={message.content} className="markdown-preview text-sm" />
            </div>
          ) : !message.thinking ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
              {streaming ? '正在思考...' : '(没有返回内容,请检查后端日志或换个模型再试)'}
            </div>
          ) : null}
        </div>
        {message.content && !streaming && !editing && (
          <div className="flex items-center gap-3 opacity-0 transition-opacity group-hover/msg:opacity-100">
            <button
              type="button"
              onClick={onCopy}
              className="flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" />
                  已复制
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  复制
                </>
              )}
            </button>
            {onEditResend && (
              <button
                type="button"
                onClick={startEdit}
                className="flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground"
                title="编辑并重发"
              >
                <Pencil className="h-3 w-3" />
                编辑
              </button>
            )}
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground"
                title="重新生成"
              >
                <RotateCcw className="h-3 w-3" />
                重新生成
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="ml-auto flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-destructive"
                title="删除这条消息"
              >
                <Trash2 className="h-3 w-3" />
                删除
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/** 仿 cherry-studio 的折叠思考块:streaming 时默认展开,完成后默认折叠 */
function ThinkingBlock({
  content,
  streaming,
}: {
  content: string
  streaming: boolean
}) {
  const [open, setOpen] = useState(streaming)
  const wasStreamingRef = useRef(streaming)

  // 流结束的瞬间自动折叠
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) setOpen(false)
    if (!wasStreamingRef.current && streaming) setOpen(true)
    wasStreamingRef.current = streaming
  }, [streaming])

  return (
    <div className="rounded-lg border border-border bg-secondary/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/50"
      >
        <Brain className={cn('h-3.5 w-3.5', streaming && 'animate-pulse')} />
        <span className="font-medium">{streaming ? '正在思考...' : '思考过程'}</span>
        <span className="text-[10px] opacity-60">({content.length} 字)</span>
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 transition-transform',
            open ? 'rotate-180' : '',
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <div className="whitespace-pre-wrap break-words font-mono">{content}</div>
        </div>
      )}
    </div>
  )
}

function pickFirst<T>(r: any): T | undefined {
  if (r == null) return undefined
  if (Array.isArray(r)) return r[0] as T
  if (r['0'] !== undefined) return r['0'] as T
  if (typeof r === 'object' && 'id' in r) return r as T
  return undefined
}

function pickSecond(r: any): string {
  if (r == null) return ''
  if (Array.isArray(r)) return (r[1] as string) ?? ''
  if (r['1'] !== undefined) return (r['1'] as string) ?? ''
  return ''
}
