import { useCallback, useState } from 'react'
import { ToolShell } from '@/components/tool/ToolShell'
import { SearchApp } from '../../../wailsjs/go/main/App'
import type { appsearch } from '../../../wailsjs/go/models'
import { SearchForm, type FormState } from './SearchForm'
import { ResultTable } from './ResultTable'
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
    >
      <div className="flex flex-col gap-4">
        <SearchForm form={form} onChange={setForm} onRun={run} disabled={running} />
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
