import { useCallback, useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToolShell } from '@/components/tool/ToolShell'
import { SearchApp, HasQimaiCredential } from '../../../wailsjs/go/main/App'
import type { appsearch } from '../../../wailsjs/go/models'
import { SearchForm, type FormState } from './SearchForm'
import { ResultTable } from './ResultTable'
import { ConfigDialog } from './ConfigDialog'
import { meta } from './meta'

const initialForm: FormState = {
  keyword: '',
  country: 'cn',
  sources: ['itunes', 'qimai_ios', 'yingyongbao'],
  market: 6, // 默认华为
}

export default function AppSearch() {
  const [form, setForm] = useState<FormState>(initialForm)
  const [running, setRunning] = useState(false)
  const [items, setItems] = useState<appsearch.SearchResultItem[]>([])
  const [statuses, setStatuses] = useState<appsearch.SourceStatus[]>([])
  const [error, setError] = useState<string>('')
  const [configOpen, setConfigOpen] = useState(false)
  // 七麦登录态配没配。源列表要据此把提示换成可点的"去配置"
  const [configured, setConfigured] = useState<boolean | null>(null)

  const refreshConfigured = useCallback(async () => {
    try {
      setConfigured((await HasQimaiCredential()) as unknown as boolean)
    } catch {
      setConfigured(false)
    }
  }, [])

  useEffect(() => {
    void refreshConfigured()
  }, [refreshConfigured])

  const run = useCallback(async () => {
    setRunning(true)
    setError('')
    try {
      const resp = await SearchApp({
        keyword: form.keyword.trim(),
        country: form.country,
        sources: form.sources,
        market: form.market,
        // 工具页保留 20 条/源的浏览体验;外部 API 调用默认 5(后端 service 自处理)
        limit_per_source: 20,
      })
      setItems(resp.items ?? [])
      setStatuses(resp.statuses ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setItems([])
      setStatuses([])
    } finally {
      setRunning(false)
    }
  }, [form])

  const clear = () => {
    setForm(initialForm)
    setItems([])
    setStatuses([])
    setError('')
  }

  return (
    <ToolShell
      title={meta.title}
      description={meta.description}
      onClear={clear}
      actions={
        <Button variant="ghost" size="sm" onClick={() => setConfigOpen(true)} title="包名搜索配置">
          <Settings className="h-3.5 w-3.5" />
          配置
        </Button>
      }
    >
      <ConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onChanged={() => void refreshConfigured()}
      />
      <div className="flex flex-col gap-4">
        <SearchForm
          form={form}
          onChange={setForm}
          onRun={run}
          disabled={running}
          configured={configured}
          onConfigure={() => setConfigOpen(true)}
        />
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <ResultTable items={items} statuses={statuses} />
      </div>
    </ToolShell>
  )
}
