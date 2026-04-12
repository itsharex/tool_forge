import { useState } from 'react'
import { AlertTriangle, Copy, RefreshCw } from 'lucide-react'
import { ToolShell } from '@/components/tool/ToolShell'
import { Button } from '@/components/ui/button'
import { GenerateCharlesKey } from '../../../wailsjs/go/main/App'
import { meta } from './meta'

export default function CharlesKey() {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const generate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      const result = await GenerateCharlesKey(name.trim())
      setKey(result)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolShell
      title={meta.title}
      description={meta.description}
      onClear={() => {
        setName('')
        setKey('')
      }}
    >
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            本工具仅供学习研究与体验软件功能。如有长期使用需求，请购买官方许可证以支持正版软件。
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            注册名称 (Registered Name)
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && generate()}
            placeholder="输入你想用的注册名…"
            spellCheck={false}
            className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <Button onClick={generate} disabled={!name.trim() || loading} className="w-full">
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {loading ? '生成中…' : '生成激活码'}
        </Button>

        {key && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">License Key</label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-3">
              <code className="flex-1 break-all font-mono text-sm">{key}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(key)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              将此 Key 连同注册名填入 Charles → Help → Register Charles
            </p>
          </div>
        )}
      </div>
    </ToolShell>
  )
}
