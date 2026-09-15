import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Blocks, Plug, RefreshCw, Sparkles } from 'lucide-react'
import { ScanAIConfig } from '../../../wailsjs/go/main/App'
import type { aiconfig } from '../../../wailsjs/go/models'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SourceViewer } from './aiconfig/SourceViewer'
import { OriginBadge, SourceLine } from './aiconfig/Source'

type SubTab = 'mcp' | 'skills' | 'plugins'

/**
 * 本机 AI 配置 —— 一处看全 MCP / skills / 插件,每条都标明出自哪个文件。
 *
 * 为什么要有这一页:同一台机器上 MCP 散在四个地方(我们自己的 servers.json、
 * Claude 的 ~/.claude.json 全局段、~/.claude.json 里每个项目各自一份、
 * Codex 的 config.toml),skills 散在三个地方(两家的 skills 目录 + 插件自带的),
 * 插件的「装了」和「启用了」还分别记在两个文件里。
 *
 * 真机上扫出来立刻能看到这种局面的代价:同一个 context7 在两处各配了一份、
 * acemcp 和 jshook 全局和项目级各有一份、有个插件启用了却根本没装。
 * 这些在分开看的时候一个都发现不了。
 */
export function AIConfigSection() {
  const [tab, setTab] = useState<SubTab>('mcp')
  const [snap, setSnap] = useState<aiconfig.Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setSnap((await ScanAIConfig()) as unknown as aiconfig.Snapshot)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = {
    mcp: snap?.mcp?.length ?? 0,
    skills: snap?.skills?.length ?? 0,
    plugins: snap?.plugins?.length ?? 0,
  }

  return (
    <div className="mx-auto flex h-full min-h-[560px] w-full max-w-6xl flex-col gap-5">
      <header className="shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">本机 AI 配置</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Claude Code、Codex 和工具箱自己的 MCP、skills、插件都在这儿,每条都标着出自哪个文件
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            重新扫描
          </Button>
        </div>
        {snap && snap.roots?.length > 0 && (
          <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={snap.roots.join('\n')}>
            扫描范围：{snap.roots.join('  ·  ')}
          </p>
        )}
      </header>

      {/* 解析失败的文件必须摆出来:它在列表上的表现是「这一处什么都没有」,
          和「这一处本来就是空的」一模一样,而前者是要处理的 */}
      {snap && snap.problems?.length > 0 && (
        <div className="shrink-0 space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-400">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            有 {snap.problems.length} 个文件没读成,下面列出的内容是不全的
          </div>
          {snap.problems.map((p) => (
            <div key={p.file} className="font-mono">
              {p.file} —— {p.detail}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border">
        <SubTabButton active={tab === 'mcp'} onClick={() => setTab('mcp')}>
          <Plug className="h-3.5 w-3.5" />
          MCP 服务器 {counts.mcp}
        </SubTabButton>
        <SubTabButton active={tab === 'skills'} onClick={() => setTab('skills')}>
          <Sparkles className="h-3.5 w-3.5" />
          Skills {counts.skills}
        </SubTabButton>
        <SubTabButton active={tab === 'plugins'} onClick={() => setTab('plugins')}>
          <Blocks className="h-3.5 w-3.5" />
          插件 {counts.plugins}
        </SubTabButton>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !snap ? (
          <Hint>扫描中…</Hint>
        ) : tab === 'mcp' ? (
          <MCPList items={snap?.mcp ?? []} onOpen={setViewing} />
        ) : tab === 'skills' ? (
          <SkillList items={snap?.skills ?? []} onOpen={setViewing} />
        ) : (
          <PluginList items={snap?.plugins ?? []} onOpen={setViewing} />
        )}
      </div>

      <SourceViewer path={viewing} onClose={() => setViewing('')} onSaved={() => void load()} />
    </div>
  )
}

/** MCP:重复的那些要能一眼看出来,这正是分开看时发现不了的 */
function MCPList({ items, onOpen }: { items: aiconfig.MCPEntry[]; onOpen: (p: string) => void }) {
  // 同名出现多次 = 在好几个地方各配了一份
  const dupes = useMemo(() => {
    const n = new Map<string, number>()
    for (const m of items) n.set(m.name, (n.get(m.name) ?? 0) + 1)
    return new Set([...n.entries()].filter(([, c]) => c > 1).map(([k]) => k))
  }, [items])

  if (items.length === 0) return <Hint>没扫到 MCP 服务器</Hint>
  return (
    <ul className="space-y-1.5">
      {items.map((m, i) => (
        <li key={`${m.source.file}-${m.source.scope}-${m.name}-${i}`} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <OriginBadge origin={m.source.origin} />
            <span className="font-medium">{m.name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {m.kind}
            </span>
            {dupes.has(m.name) && (
              <span
                className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400"
                title="这个名字在多处各配了一份 —— 分开看的时候发现不了"
              >
                多处重复
              </span>
            )}
            {!m.enabled && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                已停用
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={m.url || m.command}>
            {m.url || [m.command, ...(m.args ?? [])].join(' ')}
          </div>
          {/* 环境变量只列键名:里面常年躺着 API key */}
          {m.envKeys && m.envKeys.length > 0 && (
            <div className="mt-1 text-[10px] text-muted-foreground">
              环境变量：{m.envKeys.join('、')}
              <span className="ml-1 opacity-70">(只列键名)</span>
            </div>
          )}
          <SourceLine source={m.source} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  )
}

function SkillList({ items, onOpen }: { items: aiconfig.SkillEntry[]; onOpen: (p: string) => void }) {
  if (items.length === 0) return <Hint>没扫到 skills</Hint>
  return (
    <ul className="space-y-1.5">
      {items.map((s, i) => (
        <li key={`${s.dir}-${i}`} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <OriginBadge origin={s.source.origin} />
            <span className="font-medium">{s.name}</span>
            <span className="text-[10px] text-muted-foreground">{s.fileCount} 个文件</span>
            {!s.hasSkillMd && (
              <span
                className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400"
                title="没有 SKILL.md,多半不会被加载"
              >
                缺 SKILL.md
              </span>
            )}
          </div>
          {s.description && (
            <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{s.description}</div>
          )}
          <SourceLine
            source={{ ...s.source, file: s.hasSkillMd ? `${s.dir}\\SKILL.md` : s.dir }}
            onOpen={onOpen}
            openable={s.hasSkillMd}
          />
        </li>
      ))}
    </ul>
  )
}

function PluginList({ items, onOpen }: { items: aiconfig.PluginEntry[]; onOpen: (p: string) => void }) {
  if (items.length === 0) return <Hint>没扫到插件</Hint>
  return (
    <ul className="space-y-1.5">
      {items.map((p) => (
        <li key={p.name} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <OriginBadge origin={p.source.origin} />
            <span className="font-medium">{p.name}</span>
            {p.version && <span className="text-[10px] text-muted-foreground">v{p.version}</span>}
            {/* 「装了」和「启用了」是两个文件各自记的,实测会对不上。
                对不上时插件是静默不起作用的,不点破没人会发现 */}
            {p.enabled && !p.installed ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                启用了但没装
              </span>
            ) : !p.enabled && p.installed ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                装了但没启用
              </span>
            ) : (
              <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                已启用
              </span>
            )}
            {p.skillCount > 0 && (
              <span className="text-[10px] text-muted-foreground">自带 {p.skillCount} 个 skill</span>
            )}
          </div>
          {p.installPath && (
            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={p.installPath}>
              {p.installPath}
            </div>
          )}
          <SourceLine source={p.source} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  )
}

function SubTabButton({
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
      onClick={onClick}
      className={cn(
        'relative flex h-10 items-center gap-1.5 px-3 text-sm transition-colors',
        active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-info" />}
    </button>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
