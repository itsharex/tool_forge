import { ChevronRight, Home, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 路径条。
 *
 * 不能一股脑全铺出来:iOS 上一条真实路径长这样 ——
 * /private/var/mobile/Containers/Data/Application/<36 位 UUID>/Library/Caches/...
 * 十来段,每段都不短,直接平铺会换两三行,把下面的列表挤走,
 * 而且真正要看的"当前在哪个目录"反而淹在中间。
 *
 * 所以:开头留起点、结尾留最后两段,中间折叠成一个可点开的省略号。
 */

/** keepTail 末尾保留几段。当前目录和它的父目录 —— 定位靠的就是这两个 */
const KEEP_TAIL = 2

interface Props {
  path: string
  /** 会话的起点(Android 是 /data/data,iOS 是 mobile 的 Library),比 / 有用得多 */
  startPath: string
  onGo: (p: string) => void
}

export function Breadcrumbs({ path, startPath, onGo }: Props) {
  const parts = path.split('/').filter(Boolean)
  const full = (i: number) => '/' + parts.slice(0, i + 1).join('/')

  // 段数不多就全铺,折叠反而碍事
  const collapse = parts.length > KEEP_TAIL + 1
  const head = collapse ? parts.slice(0, parts.length - KEEP_TAIL) : []
  const tail = collapse ? parts.slice(parts.length - KEEP_TAIL) : parts
  const tailStart = parts.length - tail.length

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 text-[11px] text-muted-foreground">
      <Crumb
        label={<Home className="h-3 w-3" />}
        title={`回到起点 ${startPath}`}
        onClick={() => onGo(startPath)}
      />
      <Sep />
      {collapse && (
        <>
          {/* 折叠起来的那几段还是要能点 —— 中间某一层往往正是要回去的地方 */}
          <div className="group relative">
            <button
              className="flex items-center rounded px-1 hover:bg-secondary hover:text-foreground"
              title={head.map((_, i) => full(i)).join('\n')}
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
            <div className="absolute left-0 top-full z-20 hidden min-w-[220px] max-w-[420px] flex-col rounded-md border border-border bg-popover p-1 shadow-lg group-hover:flex">
              {head.map((seg, i) => (
                <button
                  key={full(i)}
                  onClick={() => onGo(full(i))}
                  className="truncate rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-secondary hover:text-foreground"
                  title={full(i)}
                >
                  {seg}
                </button>
              ))}
            </div>
          </div>
          <Sep />
        </>
      )}
      {tail.map((seg, i) => {
        const idx = tailStart + i
        const last = idx === parts.length - 1
        return (
          <span key={full(idx)} className="flex min-w-0 items-center gap-0.5">
            <Crumb
              label={seg}
              title={full(idx)}
              active={last}
              onClick={() => onGo(full(idx))}
            />
            {!last && <Sep />}
          </span>
        )
      })}
    </div>
  )
}

function Crumb({
  label,
  title,
  active,
  onClick,
}: {
  label: React.ReactNode
  title: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'max-w-[200px] truncate rounded px-1 py-0.5 font-mono transition-colors hover:bg-secondary hover:text-foreground',
        active && 'font-medium text-foreground'
      )}
    >
      {label}
    </button>
  )
}

function Sep() {
  return <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
}
