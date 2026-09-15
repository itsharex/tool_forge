import { useEffect, useMemo, useState } from 'react'
import { Eye, Pencil, Save } from 'lucide-react'
import { ReadAIConfigFile, SaveAIConfigFile } from '../../../wailsjs/go/main/App'
import type { aiconfig } from '../../../wailsjs/go/models'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CodeEditor, type EditorLanguage } from '@/components/tool/CodeEditor'
import { MarkdownPreview } from '@/components/tool/MarkdownPreview'
import { useConfirm } from '@/components/ui/confirm'

function languageOf(path: string): EditorLanguage {
  const p = path.toLowerCase()
  if (p.endsWith('.json')) return 'json'
  if (p.endsWith('.md')) return 'markdown'
  if (p.endsWith('.toml')) return 'ini' // CodeMirror 没有 toml,ini 的高亮最接近
  if (p.endsWith('.yaml') || p.endsWith('.yml')) return 'yaml'
  return 'plaintext'
}

/**
 * 看/改一个配置文件。
 *
 * 原文本进、原文本出,不解析也不重新序列化 —— 这些文件是别的程序在维护的,
 * 里面有手写的注释、缩进、键的顺序。转一圈结构体再写回去,认不出的字段会消失,
 * TOML 的注释会全没,而用户以为自己只改了一个值。
 *
 * Markdown 默认渲染着看:SKILL.md 是给人读的文档,一屏 `#` 和 `---` 是源码不是内容。
 * 要改再切到编辑;切换只换视图,文本是同一份。
 */
export function SourceViewer({
  path,
  onClose,
  onSaved,
}: {
  path: string
  onClose: () => void
  onSaved: () => void
}) {
  const dialog = useConfirm()
  const [file, setFile] = useState<aiconfig.FileContent | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // md 的编辑态。换文件时归零,免得上一个文件切到编辑、下一个 md 一打开就是源码
  const [editing, setEditing] = useState(false)

  const language = languageOf(path)
  const isMarkdown = language === 'markdown'

  useEffect(() => {
    setEditing(false)
    if (!path) {
      setFile(null)
      setText('')
      setError('')
      return
    }
    let alive = true
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const got = (await ReadAIConfigFile(path)) as unknown as aiconfig.FileContent
        if (!alive) return
        setFile(got)
        setText(got.content)
      } catch (e) {
        if (alive) setError(String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [path])

  const dirty = !!file && text !== file.content
  const canSave = !!file?.editable && dirty && !saving

  const close = async () => {
    // 改了一半直接关掉,改动就没了 —— 这种丢失用户完全不会预期
    if (dirty && !(await dialog({
      title: '还没保存',
      message: '关掉的话这次的改动就没了。确定关闭？',
      confirmLabel: '关掉不保存',
      danger: true,
    }))) {
      return
    }
    onClose()
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await SaveAIConfigFile(path, text)
      onSaved()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  // 只有 md 在预览态时才拆 frontmatter;编辑态要看到原文,frontmatter 也是原文的一部分
  const showPreview = isMarkdown && !editing
  const md = useMemo(() => (showPreview ? splitFrontmatter(text) : null), [showPreview, text])

  return (
    <Dialog
      open={!!path}
      onClose={() => void close()}
      title={path.split(/[\\/]/).pop() ?? '配置文件'}
      description={path}
      width="w-[900px]"
      footer={
        <>
          <Button size="sm" onClick={() => void save()} disabled={!canSave}>
            <Save className="h-3.5 w-3.5" />
            {saving ? '保存中…' : '保存'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void close()}>
            关闭
          </Button>
          {/* 改的是别家程序的配置,改坏了对方可能起不来 —— 所以写前留备份,
              而且这件事要让人知道 */}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {file?.editable
              ? '保存前会在同目录留一份带时间戳的 .bak'
              : file?.reason || '只读'}
            {dirty && <span className="ml-2 text-amber-600 dark:text-amber-400">· 有未保存的改动</span>}
          </span>
        </>
      }
    >
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-destructive">
          {error}
        </div>
      )}

      {/* md 的视图开关放内容区顶上而不是 footer:它管的是上面这块怎么显示,离得近才对得上 */}
      {isMarkdown && file && (
        <div className="-mb-2 flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setEditing((v) => !v)}
            disabled={!file.editable && !editing}
            title={editing ? '切回渲染预览' : file.editable ? '看源码并编辑' : '只读,不能编辑'}
          >
            {editing ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {editing ? '预览' : '编辑'}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-muted-foreground">读取中…</div>
      ) : !file ? null : showPreview && md ? (
        <div className="space-y-3">
          {/* SKILL.md 开头那段 YAML 是给程序看的元数据,直接丢进 Markdown 渲染
              会变成一条水平线夹着一坨乱字。单独摆成一张卡,人一眼知道这是什么 */}
          {md.meta.length > 0 && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-[11px]">
              {md.meta.map(([k, v]) => (
                <FrontmatterRow key={k} k={k} v={v} />
              ))}
            </dl>
          )}
          <MarkdownPreview
            value={md.body}
            className="rounded-lg border border-border bg-card px-6 py-5 text-[13px]"
          />
        </div>
      ) : (
        <CodeEditor
          value={text}
          onChange={setText}
          language={language}
          readOnly={!file.editable}
          minHeight="420px"
          className="overflow-hidden rounded-md border border-border"
        />
      )}
    </Dialog>
  )
}

function FrontmatterRow({ k, v }: { k: string; v: string | string[] }) {
  return (
    <>
      <dt className="font-mono text-muted-foreground">{k}</dt>
      <dd className="min-w-0">
        {Array.isArray(v) ? (
          <span className="flex flex-wrap gap-1">
            {v.map((x) => (
              <span key={x} className="rounded bg-secondary px-1.5 py-px font-mono text-[10px]">
                {x}
              </span>
            ))}
          </span>
        ) : (
          <span className="break-words">{v}</span>
        )}
      </dd>
    </>
  )
}

/**
 * 把开头的 YAML frontmatter 拆出来。
 *
 * 只认最简单的两种写法:`key: value` 和 `key:` 后跟 `- item` 列表 —— SKILL.md 的
 * frontmatter 就这两种。真出现嵌套对象之类的写法,整段按原样丢给 Markdown,不猜。
 */
export function splitFrontmatter(src: string): { meta: [string, string | string[]][]; body: string } {
  const s = src.replace(/\r\n/g, '\n')
  if (!s.startsWith('---\n')) return { meta: [], body: s }
  const end = s.indexOf('\n---', 4)
  if (end < 0) return { meta: [], body: s }

  const head = s.slice(4, end)
  // 结束线后面紧跟的换行也吃掉,否则正文开头多一个空行
  const body = s.slice(end + 4).replace(/^\n/, '')

  const meta: [string, string | string[]][] = []
  let current: [string, string[]] | null = null
  for (const raw of head.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && current) {
      current[1].push(item[1].trim().replace(/^["']|["']$/g, ''))
      continue
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) {
      // 认不出的行:放弃拆分,整段交给 Markdown —— 显示成一坨总比丢掉强
      return { meta: [], body: s }
    }
    current = null
    const [, k, v] = kv
    if (v === '') {
      current = [k, []]
      meta.push([k, current[1]])
    } else {
      meta.push([k, v.replace(/^["']|["']$/g, '')])
    }
  }
  return { meta, body }
}
