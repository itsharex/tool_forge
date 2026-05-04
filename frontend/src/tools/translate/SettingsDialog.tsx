import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslateStore, type DetectMethod } from './store'
import { cn } from '@/lib/utils'

export function SettingsDialog({
  onClose,
  onOpenMore,
}: {
  onClose: () => void
  onOpenMore: () => void
}) {
  const s = useTranslateStore()
  const set = s.setMany

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-[480px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className="text-sm font-semibold">翻译设置</h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
          <ToggleRow
            label="Markdown 预览"
            hint="用 Markdown 渲染翻译结果(代码块/列表/链接等)"
            value={s.showMarkdown}
            onChange={(v) => set({ showMarkdown: v })}
          />
          <ToggleRow
            label="翻译完成后自动复制"
            hint="流结束后自动写入剪贴板"
            value={s.autoCopy}
            onChange={(v) => set({ autoCopy: v })}
          />
          <ToggleRow
            label="滚动同步"
            hint="左右两栏滚动位置保持同步"
            value={s.scrollSync}
            onChange={(v) => set({ scrollSync: v })}
          />

          <div className="my-2 h-px bg-border" />

          <RadioRow
            label="自动检测方法"
            hint={
              s.detectMethod === 'algorithm'
                ? '使用 franc-min 离线算法,无 token 消耗'
                : s.detectMethod === 'llm'
                  ? '调用模型识别,准确度更高但消耗 token'
                  : 'franc 优先,识别不出再降级到模型'
            }
            value={s.detectMethod}
            onChange={(v) => set({ detectMethod: v as DetectMethod })}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'algorithm', label: '算法' },
              { value: 'llm', label: 'LLM' },
            ]}
          />

          <ToggleRow
            label="双向翻译"
            hint="若源语言已是目标语言,自动反向翻成上一次的源语言"
            value={s.bidirectional}
            onChange={(v) => set({ bidirectional: v })}
          />

          <div className="my-2 h-px bg-border" />

          <button
            type="button"
            onClick={() => {
              onClose()
              onOpenMore()
            }}
            className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-secondary"
          >
            <div className="text-left">
              <div className="font-medium">更多设置</div>
              <div className="text-[11px] text-muted-foreground">
                自定义翻译提示词模板
              </div>
            </div>
            <span className="text-xs text-muted-foreground">→</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-secondary"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
      <div
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          value ? 'bg-info' : 'bg-secondary',
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
            value ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </div>
    </button>
  )
}

function RadioRow({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="rounded-md px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{label}</div>
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        </div>
        <div className="flex shrink-0 gap-1 rounded-md border border-border bg-background p-0.5">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={cn(
                'rounded px-2.5 py-1 text-xs transition-colors',
                value === o.value
                  ? 'bg-info/15 text-info'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
