import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { ToolShell } from '@/components/tool/ToolShell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { meta } from './meta'
import {
  formatHsl,
  formatRgb,
  parseHex,
  parseHsl,
  parseRgb,
  rgbToHex,
  rgbToHsl,
  type Rgb,
} from './logic'

type Field = 'hex' | 'rgb' | 'hsl'

const INITIAL: Rgb = { r: 99, g: 102, b: 241 }

export default function Color() {
  const [rgb, setRgb] = useState<Rgb>(INITIAL)
  const [inputs, setInputs] = useState(() => toInputs(INITIAL))
  const [errorField, setErrorField] = useState<Field | ''>('')

  const hsl = useMemo(() => rgbToHsl(rgb), [rgb])
  const hex = useMemo(() => rgbToHex(rgb), [rgb])
  const hexDisplay = hex.toUpperCase()
  const rgbDisplay = formatRgb(rgb)
  const hslDisplay = formatHsl(hsl)

  const applyField = (field: Field, raw: string) => {
    setInputs((prev) => ({ ...prev, [field]: raw }))
    if (!raw.trim()) {
      setErrorField('')
      return
    }
    try {
      const parsed: Rgb =
        field === 'hex' ? parseHex(raw) : field === 'rgb' ? parseRgb(raw) : parseHsl(raw)
      setRgb(parsed)
      setErrorField('')
      setInputs(toInputs(parsed))
    } catch {
      setErrorField(field)
    }
  }

  return (
    <ToolShell
      title={meta.title}
      description={meta.description}
      onClear={() => {
        setRgb({ r: 255, g: 255, b: 255 })
        setInputs(toInputs({ r: 255, g: 255, b: 255 }))
        setErrorField('')
      }}
      onLoadExample={() => {
        setRgb(INITIAL)
        setInputs(toInputs(INITIAL))
        setErrorField('')
      }}
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-stretch gap-4 rounded-lg border border-border bg-card p-4">
          <div
            className="h-32 w-32 shrink-0 rounded-md border border-border"
            style={{ backgroundColor: hexDisplay }}
          />
          <div className="flex flex-1 flex-col justify-between">
            <div>
              <div className="text-xs text-muted-foreground">当前颜色</div>
              <div className="mt-1 font-mono text-2xl font-semibold">{hexDisplay}</div>
            </div>
            <input
              type="color"
              value={hex}
              onChange={(e) => {
                const parsed = parseHex(e.target.value)
                setRgb(parsed)
                setInputs(toInputs(parsed))
                setErrorField('')
              }}
              className="h-9 w-full cursor-pointer rounded-md border border-input bg-background"
            />
          </div>
        </div>

        <Field
          label="HEX"
          value={inputs.hex}
          preview={hexDisplay}
          onChange={(v) => applyField('hex', v)}
          error={errorField === 'hex'}
        />
        <Field
          label="RGB"
          value={inputs.rgb}
          preview={rgbDisplay}
          onChange={(v) => applyField('rgb', v)}
          error={errorField === 'rgb'}
        />
        <Field
          label="HSL"
          value={inputs.hsl}
          preview={hslDisplay}
          onChange={(v) => applyField('hsl', v)}
          error={errorField === 'hsl'}
        />
      </div>
    </ToolShell>
  )
}

function toInputs(rgb: Rgb) {
  return {
    hex: rgbToHex(rgb).toUpperCase(),
    rgb: formatRgb(rgb),
    hsl: formatHsl(rgbToHsl(rgb)),
  }
}

function Field({
  label,
  value,
  preview,
  onChange,
  error,
}: {
  label: string
  value: string
  preview: string
  onChange: (v: string) => void
  error?: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border bg-card px-3 h-11',
          error ? 'border-destructive' : 'border-border focus-within:border-foreground/30'
        )}
      >
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder={preview}
          className="flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60"
        />
        {error && <span className="text-xs text-destructive">格式错误</span>}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(preview)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
    </div>
  )
}
