import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { ReadAIConfigFile, SaveAIConfigFile } from '../../../../wailsjs/go/main/App'
import type { aiconfig } from '../../../../wailsjs/go/models'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CodeEditor, type EditorLanguage } from '@/components/tool/CodeEditor'
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

  useEffect(() => {
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

  return (
    <Dialog
      open={!!path}
      onClose={() => void close()}
      title={path.split(/[\\/]/).pop() ?? '配置文件'}
      description={path}
      width="w-[860px]"
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
      {loading ? (
        <div className="py-10 text-center text-muted-foreground">读取中…</div>
      ) : file ? (
        <CodeEditor
          value={text}
          onChange={setText}
          language={languageOf(path)}
          readOnly={!file.editable}
          minHeight="420px"
          className="overflow-hidden rounded-md border border-border"
        />
      ) : null}
    </Dialog>
  )
}
