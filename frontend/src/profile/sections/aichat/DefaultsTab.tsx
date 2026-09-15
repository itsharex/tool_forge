import { useEffect, useState } from 'react'
import { MessagesSquare, Save, Sparkles, Wrench } from 'lucide-react'
import {
  ListAIProviders,
  GetAIConfig,
  SaveAIConfig,
} from '../../../../wailsjs/go/main/App'
import type { Provider, AIConfig } from '@/tools/ai-chat/types'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'

export function DefaultsTab() {
  const dialog = useConfirm()
  const [providers, setProviders] = useState<Provider[]>([])
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  // 自动起标题。后端存的是"关"(老配置没有这个字段 → 零值 → 开着),
  // 这里翻成正向的"开"再给界面用,免得整个组件里到处都是双重否定
  const [autoTitle, setAutoTitle] = useState(true)
  const [titleProviderId, setTitleProviderId] = useState('')
  const [titleModelId, setTitleModelId] = useState('')
  const [localTools, setLocalTools] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    void (async () => {
      const list = ((await ListAIProviders()) ?? []) as unknown as Provider[]
      setProviders(list)
      const cfg = (await GetAIConfig()) as unknown as AIConfig
      setProviderId(cfg.defaultProviderId ?? '')
      setModelId(cfg.defaultModelId ?? '')
      setAutoTitle(!cfg.autoTitleOff)
      setTitleProviderId(cfg.titleProviderId ?? '')
      setTitleModelId(cfg.titleModelId ?? '')
      setLocalTools(!!cfg.localTools)
    })()
  }, [])

  const enabled = providers.filter((p) => p.enabled && p.models.length > 0)
  const currentProvider = enabled.find((p) => p.id === providerId)
  const modelOptions = currentProvider?.models ?? []
  const titleProvider = enabled.find((p) => p.id === titleProviderId)

  const onSave = async () => {
    const err = (await SaveAIConfig({
      defaultProviderId: providerId,
      defaultModelId: modelId,
      autoTitleOff: !autoTitle,
      // 只选了供应商没选模型等于没配。半套配置存下去,后端每次都要判一遍
      // "两个字段是不是都在" —— 干脆在这里就不让它成形
      titleProviderId: titleModelId ? titleProviderId : '',
      titleModelId: titleProviderId ? titleModelId : '',
      // 后端是整个结构体盖上去的,这里漏一个字段就等于把它关掉 ——
      // 保存个默认模型,工具箱工具就被顺手关了
      localTools,
    } as unknown as never)) as unknown as string
    if (err) {
      await dialog({ title: '保存失败', message: err, confirmLabel: '知道了' })
      return
    }
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <MessagesSquare className="h-4 w-4 text-info" />
          默认助手模型
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
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value)
                  const next = enabled.find((p) => p.id === e.target.value)
                  setModelId(next?.models[0] ?? '')
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
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
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

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={onSave} disabled={enabled.length === 0} size="sm">
            <Save className="h-3.5 w-3.5" />
            保存
          </Button>
          {savedFlash && <span className="text-xs text-success">已保存</span>}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-info" />
          自动起标题
        </div>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={autoTitle}
            onChange={(e) => setAutoTitle(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          <span className="text-xs">
            首轮问答结束后,让模型给会话起个标题
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              只在第一轮之后起一次;你手动改过名字的会话不会被覆盖
            </span>
          </span>
        </label>

        {autoTitle && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              专用模型
              <span className="ml-2 font-normal">· 留空就用会话自己的模型</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={titleProviderId}
                onChange={(e) => {
                  setTitleProviderId(e.target.value)
                  setTitleModelId('')
                }}
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
                value={titleModelId}
                onChange={(e) => setTitleModelId(e.target.value)}
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
        </div>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={localTools}
            onChange={(e) => setLocalTools(e.target.checked)}
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
