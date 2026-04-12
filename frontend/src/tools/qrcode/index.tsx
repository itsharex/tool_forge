import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { ToolShell } from '@/components/tool/ToolShell'
import { Button } from '@/components/ui/button'
import { meta } from './meta'
import { ERROR_LEVELS, renderToCanvas, renderToDataUrl, type ErrorLevel } from './logic'
import { cn } from '@/lib/utils'

const EXAMPLE = 'https://github.com/'

export default function QrCodeTool() {
  const [text, setText] = useState('')
  const [level, setLevel] = useState<ErrorLevel>('M')
  const [size, setSize] = useState(256)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!text) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
      setError('')
      return
    }
    renderToCanvas(canvas, text, level, size)
      .then(() => setError(''))
      .catch((e) => setError(e instanceof Error ? e.message : '生成失败'))
  }, [text, level, size])

  const download = async () => {
    if (!text) return
    const url = await renderToDataUrl(text, level, size)
    const a = document.createElement('a')
    a.href = url
    a.download = 'qrcode.png'
    a.click()
  }

  return (
    <ToolShell
      title={meta.title}
      description={meta.description}
      onClear={() => setText('')}
      onLoadExample={() => setText(EXAMPLE)}
      actions={
        <Button variant="default" size="sm" onClick={download} disabled={!text}>
          <Download className="h-3.5 w-3.5" />
          下载 PNG
        </Button>
      }
    >
      <div className="mx-auto grid h-full max-w-4xl grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              文本 / 链接
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入要生成二维码的内容…"
              spellCheck={false}
              className="min-h-[180px] w-full resize-y bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                容错等级
              </label>
              <div className="flex gap-2">
                {ERROR_LEVELS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setLevel(opt.value)}
                    className={cn(
                      'flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors',
                      level === opt.value
                        ? 'border-foreground/30 bg-accent font-medium'
                        : 'border-input bg-background hover:bg-accent'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>尺寸</span>
                <span className="font-mono">{size}px</span>
              </label>
              <input
                type="range"
                min={128}
                max={512}
                step={16}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center rounded-lg border border-border bg-card p-6">
          {text ? (
            <canvas
              ref={canvasRef}
              className="max-h-full max-w-full rounded"
            />
          ) : (
            <div className="text-center text-sm text-muted-foreground">
              输入内容后将显示二维码
            </div>
          )}
          {error && (
            <div className="absolute mt-2 text-xs text-destructive">{error}</div>
          )}
        </div>
      </div>
    </ToolShell>
  )
}
