import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SOURCES, COUNTRIES, ANDROID_MARKETS, type SourceID } from './types'

export interface FormState {
  keyword: string
  country: string
  sources: SourceID[]
  market: number // 七麦 Android 用
}

interface Props {
  form: FormState
  onChange: (next: FormState) => void
  onRun: () => void
  disabled: boolean
  /** 需要配置的源是否已经配好;null = 还在查 */
  configured: boolean | null
  /** 打开配置弹窗 */
  onConfigure: () => void
}

export function SearchForm({ form, onChange, onRun, disabled, configured, onConfigure }: Props) {
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    onChange({ ...form, [key]: value })
  }

  const toggleSource = (id: SourceID) => {
    const next = form.sources.includes(id)
      ? form.sources.filter((s) => s !== id)
      : [...form.sources, id]
    setField('sources', next)
  }

  const canRun =
    !disabled &&
    form.keyword.trim().length > 0 &&
    form.sources.length > 0

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canRun) onRun()
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
        搜索参数
      </div>

      <div className="space-y-4 p-4">
        <Field label="关键词" required hint="支持中文 / 拉丁文 / 假名">
          <input
            value={form.keyword}
            onChange={(e) => setField('keyword', e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="微信 / wechat / LINE ..."
            spellCheck={false}
            autoFocus
            className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="iOS 国家/地区" hint="仅影响 iOS 源">
            <select
              value={form.country}
              onChange={(e) => setField('country', e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Android 市场"
            hint={
              form.sources.includes('qimai_android')
                ? '七麦 Android 生效'
                : '勾选七麦 Android 后生效'
            }
          >
            <select
              value={form.market}
              onChange={(e) => setField('market', Number(e.target.value))}
              disabled={!form.sources.includes('qimai_android')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {ANDROID_MARKETS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="数据源" hint="多选，至少选一个">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SOURCES.map((s) => {
              const active = form.sources.includes(s.id)
              return (
                <label
                  key={s.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                    active
                      ? 'border-foreground/30 bg-accent'
                      : 'border-input bg-background hover:bg-accent/50',
                    !s.enabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={!s.enabled}
                    onChange={() => toggleSource(s.id)}
                    className="h-3.5 w-3.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{s.label}</span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px]',
                          s.platform === 'ios'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        )}
                      >
                        {s.platform.toUpperCase()}
                      </span>
                      {!s.enabled && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          即将推出
                        </span>
                      )}
                    </div>
                    {/* 要配置的源直接把当前状态说出来,并且就地给入口 ——
                        原来这里写死一句"Profile 里配置",既不告诉你配没配,
                        也要你自己去找那一页 */}
                    {s.needsConfig && configured === false ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onConfigure()
                        }}
                        className="truncate text-xs text-amber-700 underline underline-offset-2 dark:text-amber-400"
                      >
                        未配置登录态 · 点此配置
                      </button>
                    ) : (
                      s.hint && (
                        <div className="truncate text-xs text-muted-foreground">{s.hint}</div>
                      )
                    )}
                  </div>
                </label>
              )
            })}
          </div>
        </Field>

        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={onRun} disabled={!canRun}>
            <Play className="h-3.5 w-3.5" />
            {disabled ? '搜索中…' : '搜索'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-baseline gap-2 text-xs font-medium">
        {label}
        {required && <span className="text-destructive">*</span>}
        {hint && <span className="text-muted-foreground font-normal">· {hint}</span>}
      </label>
      {children}
    </div>
  )
}
