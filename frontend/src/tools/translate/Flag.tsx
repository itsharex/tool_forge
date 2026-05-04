import { Globe } from 'lucide-react'
import { lazy, Suspense, type ComponentType } from 'react'
import { cn } from '@/lib/utils'

/**
 * SVG 国旗组件;按 ISO 3166-1 alpha-2 国家代码加载
 *
 * country-flag-icons 是 tree-shakeable 的,每个国旗约 1-3 KB,
 * 用 React.lazy 让首屏不预加载,首次出现某个旗才下载它
 */

const FLAG_LOADERS: Record<string, () => Promise<{ default: ComponentType<{ title?: string; className?: string }> }>> = {
  CN: () => import('country-flag-icons/react/3x2/CN'),
  HK: () => import('country-flag-icons/react/3x2/HK'),
  GB: () => import('country-flag-icons/react/3x2/GB'),
  US: () => import('country-flag-icons/react/3x2/US'),
  JP: () => import('country-flag-icons/react/3x2/JP'),
  KR: () => import('country-flag-icons/react/3x2/KR'),
  FR: () => import('country-flag-icons/react/3x2/FR'),
  DE: () => import('country-flag-icons/react/3x2/DE'),
  ES: () => import('country-flag-icons/react/3x2/ES'),
  IT: () => import('country-flag-icons/react/3x2/IT'),
  PT: () => import('country-flag-icons/react/3x2/PT'),
  RU: () => import('country-flag-icons/react/3x2/RU'),
  SA: () => import('country-flag-icons/react/3x2/SA'),
  TH: () => import('country-flag-icons/react/3x2/TH'),
  VN: () => import('country-flag-icons/react/3x2/VN'),
  ID: () => import('country-flag-icons/react/3x2/ID'),
  MY: () => import('country-flag-icons/react/3x2/MY'),
  TR: () => import('country-flag-icons/react/3x2/TR'),
  PL: () => import('country-flag-icons/react/3x2/PL'),
  NL: () => import('country-flag-icons/react/3x2/NL'),
  SE: () => import('country-flag-icons/react/3x2/SE'),
  DK: () => import('country-flag-icons/react/3x2/DK'),
  NO: () => import('country-flag-icons/react/3x2/NO'),
  FI: () => import('country-flag-icons/react/3x2/FI'),
  GR: () => import('country-flag-icons/react/3x2/GR'),
  IN: () => import('country-flag-icons/react/3x2/IN'),
  CZ: () => import('country-flag-icons/react/3x2/CZ'),
  UA: () => import('country-flag-icons/react/3x2/UA'),
  IL: () => import('country-flag-icons/react/3x2/IL'),
}

const cache = new Map<string, ComponentType<{ title?: string; className?: string }>>()

function getFlag(code: string) {
  if (cache.has(code)) return cache.get(code)!
  const loader = FLAG_LOADERS[code]
  if (!loader) return null
  const Comp = lazy(loader)
  cache.set(code, Comp)
  return Comp
}

export function Flag({
  code,
  className,
}: {
  /** ISO 3166-1 alpha-2(CN/GB/JP...);为空显示地球图标 */
  code?: string
  className?: string
}) {
  if (!code) {
    return (
      <Globe
        className={cn('h-3.5 w-3.5 text-muted-foreground', className)}
      />
    )
  }
  const Comp = getFlag(code.toUpperCase())
  if (!Comp) {
    return (
      <span
        className={cn(
          'flex h-3.5 w-5 items-center justify-center rounded-sm bg-secondary text-[8px] font-mono text-muted-foreground',
          className,
        )}
      >
        {code.toUpperCase()}
      </span>
    )
  }
  return (
    <Suspense fallback={<span className={cn('inline-block h-3.5 w-5 rounded-sm bg-secondary/50', className)} />}>
      <Comp className={cn('h-3.5 w-5 rounded-sm shadow-sm', className)} />
    </Suspense>
  )
}
