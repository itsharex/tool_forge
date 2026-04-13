import { NavLink, Link } from 'react-router-dom'
import { ChevronLeft, Hammer, Home as HomeIcon, User } from 'lucide-react'
import { useLayoutStore } from '@/stores/layout'
import {
  CATEGORY_LABELS,
  getVisibleToolsByCategory,
  useToolsStore,
  type ToolCategory,
} from '@/stores/tools'
import { useProfileStore } from '@/stores/profile'
import { cn } from '@/lib/utils'

const CATEGORY_ORDER: ToolCategory[] = [
  'forensic',
  'data',
  'codec',
  'crypto',
  'time',
  'text',
  'network',
  'gen',
  'dev',
]

export function Sidebar() {
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar)
  const visibility = useToolsStore((s) => s.visibility)
  const order = useToolsStore((s) => s.order)
  const nickname = useProfileStore((s) => s.nickname)
  const grouped = getVisibleToolsByCategory(visibility, order)

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border bg-sidebar transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-56'
      )}
    >
      <div className="flex h-14 items-center justify-between px-3 border-b border-border">
        <Link
          to="/"
          title="回到首页"
          className="flex items-center gap-2 overflow-hidden rounded-md transition-opacity hover:opacity-80"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Hammer className="h-4 w-4" />
          </div>
          {!collapsed && (
            <span className="truncate font-semibold text-sm">Tool Forge</span>
          )}
        </Link>
        <button
          onClick={toggleSidebar}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          title={collapsed ? '展开' : '折叠'}
        >
          <ChevronLeft
            className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')}
          />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <div className="mb-3 px-2">
          <NavLink
            to="/"
            end
            title={collapsed ? '首页' : undefined}
            className={({ isActive }) =>
              cn(
                'flex h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-foreground',
                isActive && 'bg-accent font-medium text-foreground',
                collapsed && 'justify-center'
              )
            }
          >
            <HomeIcon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">首页</span>}
          </NavLink>
        </div>

        {CATEGORY_ORDER.map((cat) => {
          const tools = grouped[cat]
          if (!tools || tools.length === 0) return null
          return (
            <div key={cat} className="mb-3">
              {!collapsed && (
                <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </div>
              )}
              <ul className="space-y-0.5 px-2">
                {tools.map((tool) => {
                  const Icon = tool.icon
                  return (
                    <li key={tool.id}>
                      <NavLink
                        to={tool.path}
                        title={collapsed ? tool.title : undefined}
                        className={({ isActive }) =>
                          cn(
                            'flex h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-foreground',
                            isActive && 'bg-accent font-medium text-foreground',
                            collapsed && 'justify-center'
                          )
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="truncate">{tool.title}</span>}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className="border-t border-border p-2">
        <NavLink
          to="/profile"
          title={collapsed ? nickname : undefined}
          className={({ isActive }) =>
            cn(
              'flex h-10 items-center gap-2 rounded-md px-2 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-foreground',
              isActive && 'bg-accent font-medium text-foreground',
              collapsed && 'justify-center'
            )
          }
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
            <User className="h-4 w-4" />
          </div>
          {!collapsed && <span className="truncate">{nickname}</span>}
        </NavLink>
      </div>
    </aside>
  )
}
