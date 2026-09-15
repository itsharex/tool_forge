import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, MessagesSquare, Sparkles, Wrench } from 'lucide-react'
import {
  ListAIProviders,
  GetAIConfig,
  SaveAIConfig,
} from '../../../../wailsjs/go/main/App'
import type { Provider, AIConfig } from '@/tools/ai-chat/types'
import { useConfirm } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'

/**
 * 这一页的全部可改项。
 *
 * 合成一个对象而不是散着放六个 useState:后端保存是整个结构体盖上去的,
 * 落库时必须把六项一起带上 —— 散着放的话每加一项都得记得在保存那里补一行,
 * 漏了就是"改了别的设置顺手把这一项关掉"。
 */
type Draft = {
  providerId: string
  modelId: string
  autoTitle: boolean
  titleProviderId: string
  titleModelId: string
  localTools: boolean
}

const EMPTY: Draft = {
  providerId: '',
  modelId: '',
  autoTitle: true,
  titleProviderId: '',
  titleModelId: '',
  localTools: false,
}

/** 落库形态。半套的"起标题专用模型"在这里抹平,后端就不用每次判两个字段是不是都在 */
function toWire(d: Draft): AIConfig {
  return {
    defaultProviderId: d.providerId,
    defaultModelId: d.modelId,
    autoTitleOff: !d.autoTitle,
    titleProviderId: d.titleModelId ? d.titleProviderId : '',
    titleModelId: d.titleProviderId ? d.titleModelId : '',
    localTools: d.localTools,
  }
}

export function DefaultsTab() {
  const dialog = useConfirm()
  const [providers, setProviders] = useState<Provider[]>([])
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  // 最后一次确实写进磁盘的值。存失败时退回它 —— 界面不能显示成存进去了
  const savedRef = useRef<Draft>(EMPTY)
  const flashRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    void (async () => {
      const list = ((await ListAIProviders()) ?? []) as unknown as Provider[]
      setProviders(list)
      const cfg = (await GetAIConfig()) as unknown as AIConfig
      const got: Draft = {
        providerId: cfg.defaultProviderId ?? '',
        modelId: cfg.defaultModelId ?? '',
        // 后端存的是"关"(老配置没有这个字段 → 零值 → 开着),
        // 这里翻成正向的"开"再给界面用,免得整个组件里到处都是双重否定
        autoTitle: !cfg.autoTitleOff,
        titleProviderId: cfg.titleProviderId ?? '',
        titleModelId: cfg.titleModelId ?? '',
        localTools: !!cfg.localTools,
      }
      setDraft(got)
      savedRef.current = got
    })()
    return () => clearTimeout(flashRef.current)
  }, [])

  /**
   * 改一项存一项。
   *
   * 这一页原来只有一个保存按钮,而它长在「默认助手模型」那张卡片里 —— 下面两张卡片
   * 的开关看着是独立的,实际上要滚回去点那个按钮才算数,不点就白改。更糟的是那个按钮
   * 在"还没有启用任何供应商"时是禁用的:新用户连把「工具箱工具」打开都做不到。
   *
   * 这一页全是开关和下拉,没有需要"编辑到一半"的文本框,那就不该有保存这一步。
   */
  const apply = async (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setState('saving')
    const err = (await SaveAIConfig(toWire(next) as unknown as never)) as unknown as string
    if (err) {
      setDraft(savedRef.current)
      setState('idle')
      await dialog({ title: '保存失败', message: err, confirmLabel: '知道了' })
      return
    }
    savedRef.current = next
    setState('saved')
    clearTimeout(flashRef.current)
    flashRef.current = setTimeout(() => setState('idle'), 1500)
  }

  const enabled = providers.filter((p) => p.enabled && p.models.length > 0)
  const currentProvider = enabled.find((p) => p.id === draft.providerId)
  const modelOptions = currentProvider?.models ?? []
  const titleProvider = enabled.find((p) => p.id === draft.titleProviderId)

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <MessagesSquare className="h-4 w-4 text-info" />
          默认助手模型
          <SaveState state={state} />
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          新建对话时使用的模型,可在对话顶部随时切换
        </p>

        {enabled.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-secondary/30 p-6 text-center text-xs text-muted-foreground">
            还没有启用且选了模型的供应商,请先到「模型服务」配置
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">供应商</label>
              <select
                value={draft.providerId}
                onChange={(e) => {
                  const next = enabled.find((p) => p.id === e.target.value)
                  void apply({ providerId: e.target.value, modelId: next?.models[0] ?? '' })
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— 未选择 —</option>
                {enabled.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">模型</label>
              <select
                value={draft.modelId}
                onChange={(e) => void apply({ modelId: e.target.value })}
                disabled={!currentProvider}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              >
                <option value="">— 未选择 —</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-info" />
          自动起标题
          <SaveState state={state} />
        </div>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={draft.autoTitle}
            onChange={(e) => void apply({ autoTitle: e.target.checked })}
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          <span className="text-xs">
            首轮问答结束后,让模型给会话起个标题
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              只在第一轮之后起一次;你手动改过名字的会话不会被覆盖
            </span>
          </span>
        </label>

        {draft.autoTitle && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              专用模型
              <span className="ml-2 font-normal">· 留空就用会话自己的模型</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={draft.titleProviderId}
                onChange={(e) => void apply({ titleProviderId: e.target.value, titleModelId: '' })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— 跟随会话 —</option>
                {enabled.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={draft.titleModelId}
                onChange={(e) => void apply({ titleModelId: e.target.value })}
                disabled={!titleProvider}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              >
                <option value="">— 未选择 —</option>
                {(titleProvider?.models ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              起标题是一次额外的请求。挑个便宜的小模型专门干这件事,
              比让正在用的大模型顺手起要省得多。
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Wrench className="h-4 w-4 text-info" />
          工具箱工具
          <SaveState state={state} />
        </div>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={draft.localTools}
            onChange={(e) => void apply({ localTools: e.target.checked })}
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          <span className="text-xs">
            允许模型调用工具箱自带的工具
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              真机浏览、SQLite 搜索与读取、plist / MMKV / protobuf 解析、文件哈希、包名搜索。
              还要在对话输入栏打开「工具」开关才会真的带上。
            </span>
          </span>
        </label>
        {/* 这个开关的代价必须写在开关旁边,不能藏在文档里:
            工具读回来的内容会随下一轮请求发给模型供应商 */}
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
          打开后模型能读本机文件和当前连着的设备,<strong>读到的内容会随下一轮请求发给模型供应商</strong>。
          办案数据要不要出本机,自己掂量。
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          只给了只读的那批 —— 跑砸了最多这一轮白问,不会动到证据。
          「移动取证」没有放进来:它跑起来是真做一次提取,几分钟、往磁盘写几百 MB、
          还会先清空输出目录,该由人点。
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          这和「本地 API」里的工具开关是两回事:那边是放给外部 agent 走网络调用的,
          这边只在本进程内,不开端口。
        </p>
      </div>
    </div>
  )
}

/**
 * 保存状态。三张卡片各放一个 —— 共用一处的话,改下面卡片时提示在屏幕外,
 * 等于没提示:用户刚丢过一次修改,更需要看见"这次真的存上了"。
 */
function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'idle') return null
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-[11px] font-normal',
        state === 'saved' ? 'text-success' : 'text-muted-foreground',
      )}
    >
      {state === 'saving' ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          保存中
        </>
      ) : (
        <>
          <Check className="h-3 w-3" />
          已保存
        </>
      )}
    </span>
  )
}
