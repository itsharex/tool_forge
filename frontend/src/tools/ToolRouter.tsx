import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { getToolComponent } from './registry'
import { cn } from '@/lib/utils'

/**
 * Lazy keep-alive 路由：
 * - 首次访问某个 toolId 才 mount 对应组件
 * - 之后切换工具不再 unmount，仅切换可见性（display:none / block）
 * - 组件 React state 全程保留；需要清空时，各工具通过 ToolShell.onClear 自行重置
 */
export function ToolRouter() {
  const { toolId } = useParams<{ toolId: string }>()
  const [mounted, setMounted] = useState<string[]>(() => (toolId ? [toolId] : []))

  useEffect(() => {
    if (!toolId) return
    setMounted((prev) => (prev.includes(toolId) ? prev : [...prev, toolId]))
  }, [toolId])

  if (!toolId) return <Navigate to="/" replace />
  if (!getToolComponent(toolId)) return <Navigate to="/" replace />

  return (
    <div className="h-full">
      {mounted.map((id) => {
        const Component = getToolComponent(id)
        if (!Component) return null
        const active = id === toolId
        return (
          <div key={id} className={cn('h-full', !active && 'hidden')}>
            <Component />
          </div>
        )
      })}
    </div>
  )
}
