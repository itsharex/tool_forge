import type { ReactNode } from 'react'
import { Eraser, FileCode2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ToolShellProps {
  title: string
  description?: string
  actions?: ReactNode
  onClear?: () => void
  onLoadExample?: () => void
  children: ReactNode
  /**
   * 满版布局:body 变成 flex container(flex-col),去掉 padding 和外层 overflow-auto。
   * 适合需要自己接管整个内容区(多列 / 自带滚动)的工具,比如 outlook-mail、ai-chat 风格的多栏布局。
   * 默认 false,保持原有"居中表单 + 自动滚动"行为。
   */
  fullBleed?: boolean
}

export function ToolShell({
  title,
  description,
  actions,
  onClear,
  onLoadExample,
  children,
  fullBleed,
}: ToolShellProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          {description && (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {actions}
          {onLoadExample && (
            <Button variant="ghost" size="sm" onClick={onLoadExample}>
              <FileCode2 className="h-3.5 w-3.5" />
              示例
            </Button>
          )}
          {onClear && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              <Eraser className="h-3.5 w-3.5" />
              清空
            </Button>
          )}
        </div>
      </header>
      <div
        className={cn(
          'min-h-0 flex-1',
          fullBleed ? 'flex flex-col' : 'overflow-auto p-5',
        )}
        data-tool-scroll={fullBleed ? undefined : 'true'}
      >
        {children}
      </div>
    </div>
  )
}
