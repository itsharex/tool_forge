import { useEffect, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import type { Extension } from '@codemirror/state'
import { useLayoutStore } from '@/stores/layout'
import { cn } from '@/lib/utils'

interface CodeEditorProps {
  value: string
  onChange?: (v: string) => void
  extensions?: Extension[]
  readOnly?: boolean
  placeholder?: string
  /** 传 "100%" 时会让编辑器自己接管滚动并填满父级高度 */
  minHeight?: string
  className?: string
}

function resolveDark(theme: string): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function CodeEditor({
  value,
  onChange,
  extensions = [],
  readOnly,
  placeholder,
  minHeight = '200px',
  className,
}: CodeEditorProps) {
  const theme = useLayoutStore((s) => s.theme)
  const [dark, setDark] = useState(() => resolveDark(theme))

  useEffect(() => {
    if (theme !== 'system') {
      setDark(theme === 'dark')
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setDark(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [theme])

  const fill = minHeight === '100%'

  return (
    <div className={cn(fill && 'flex min-h-0 flex-col', className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        height={fill ? '100%' : undefined}
        minHeight={fill ? undefined : minHeight}
        theme={dark ? 'dark' : 'light'}
        className={fill ? 'flex-1 min-h-0 overflow-hidden' : undefined}
        extensions={[
          EditorView.lineWrapping,
          EditorView.theme({
            '&': fill ? { height: '100%' } : {},
            '.cm-scroller': { overflow: 'auto' },
          }),
          ...extensions,
        ]}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: !readOnly,
          foldGutter: true,
          bracketMatching: true,
          autocompletion: false,
        }}
      />
    </div>
  )
}
