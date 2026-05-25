import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Copy,
  Download,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  Search,
  Settings,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { avatarLetter, avatarStyle } from './avatar'
import { outlookAPI } from './api'
import type { AccountStatus, AccountView, Group } from './types'

export type SortMode = 'order' | 'created' | 'email'
export type PageSize = 20 | 50 | 100 | 200

const STATUS_BADGE: Record<AccountStatus, { label: string; cls: string }> = {
  active: { label: 'OK', cls: 'bg-success/15 text-success border-success/30' },
  token_expired: { label: 'Token 失效', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30' },
  banned: { label: '已封禁', cls: 'bg-destructive/15 text-destructive border-destructive/40' },
  unknown: { label: '未刷新', cls: 'bg-muted text-muted-foreground border-border' },
}

const PAGE_SIZE_OPTIONS: PageSize[] = [20, 50, 100, 200]

export function AccountPanel({
  accounts,
  groups,
  selectedGroupID,
  countsByGroup,
  onSelectGroup,
  onOpenGroupManager,
  hideGroupSelector,
  selectedID,
  selectedIDs,
  refreshingIDs,
  onSelect,
  onToggleSelect,
  onClearSelection,
  onOpenImport,
  onOpenAuthSave,
  onOpenExport,
  onOpenRefreshManager,
  onEditAccount,
  onRefreshAll,
  onRefreshSelected,
  onAfterChange,
}: {
  accounts: AccountView[]
  groups: Group[]
  selectedGroupID: string
  countsByGroup: Record<string, number>
  onSelectGroup: (id: string) => void
  onOpenGroupManager: () => void
  /** 宽屏布局下独立分组栏可见时,内部不渲染顶部下拉选择器,避免冗余。 */
  hideGroupSelector?: boolean
  selectedID: string
  selectedIDs: Set<string>
  refreshingIDs: Set<string>
  onSelect: (id: string) => void
  onToggleSelect: (id: string) => void
  onClearSelection: () => void
  onOpenImport: () => void
  onOpenAuthSave: () => void
  onOpenExport: () => void
  onOpenRefreshManager: () => void
  onEditAccount: (account: AccountView) => void
  onRefreshAll: () => void
  onRefreshSelected: () => void
  onAfterChange: () => void
}) {
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('order')
  const [pageSize, setPageSize] = useState<PageSize>(200)
  const [tag, setTag] = useState<string>('')
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  // 提取所有出现过的标签
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const a of accounts) for (const t of a.tags ?? []) if (t) set.add(t)
    return Array.from(set).sort()
  }, [accounts])

  const filtered = useMemo(() => {
    let list = accounts
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (a) =>
          a.email.toLowerCase().includes(q) ||
          (a.remark ?? '').toLowerCase().includes(q) ||
          (a.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      )
    }
    if (tag) {
      list = list.filter((a) => (a.tags ?? []).includes(tag))
    }
    const arr = [...list]
    switch (sortMode) {
      case 'order':
        arr.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order
          return (a.created_at < b.created_at ? 1 : -1)
        })
        break
      case 'created':
        arr.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        break
      case 'email':
        arr.sort((a, b) => a.email.localeCompare(b.email))
        break
    }
    return arr.slice(0, pageSize)
  }, [accounts, query, tag, sortMode, pageSize])

  const copySelectedEmails = async () => {
    const list = accounts.filter((a) => selectedIDs.has(a.id)).map((a) => a.email)
    if (list.length === 0) return
    await navigator.clipboard.writeText(list.join('\n'))
  }

  const deleteSelected = async () => {
    if (selectedIDs.size === 0) return
    if (!confirm(`确定删除选中的 ${selectedIDs.size} 个账号?`)) return
    for (const id of selectedIDs) {
      try {
        await outlookAPI.deleteAccount(id)
      } catch (e) {
        console.error(e)
      }
    }
    onClearSelection()
    onAfterChange()
  }

  const hasSelection = selectedIDs.size > 0
  const selectedCount = filtered.filter((a) => selectedIDs.has(a.id)).length
  const visibleTotal = filtered.length

  const totalAccountCount = accounts.length
  const currentGroup = groups.find((g) => g.id === selectedGroupID)
  const currentGroupLabel = selectedGroupID === '' ? '全部' : currentGroup?.name ?? '全部'
  const currentGroupCount =
    selectedGroupID === '' ? totalAccountCount : countsByGroup[selectedGroupID] ?? 0

  return (
    <section className="flex w-72 shrink-0 flex-col border-r border-border">
      {/* 顶部工具栏 */}
      <header className="flex h-10 shrink-0 items-center justify-between gap-1 border-b border-border px-2">
        <span className="text-xs font-medium text-foreground">
          账号 <span className="text-muted-foreground">({selectedCount}/{visibleTotal})</span>
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton onClick={onOpenRefreshManager} title="Token 刷新管理">
            <KeyRound className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton onClick={onOpenExport} title="导出邮箱">
            <Download className="h-3.5 w-3.5" />
          </IconButton>
          {/* +按钮:下拉两选 */}
          <div className="relative">
            <IconButton
              onClick={() => setAddMenuOpen((v) => !v)}
              title="添加账号"
              active={addMenuOpen}
            >
              <Plus className="h-3.5 w-3.5" />
            </IconButton>
            {addMenuOpen && (
              <DropdownPortal onClose={() => setAddMenuOpen(false)}>
                <DropdownItem
                  icon={<UserPlus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setAddMenuOpen(false)
                    onOpenAuthSave()
                  }}
                >
                  授权并保存
                </DropdownItem>
                <DropdownItem
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setAddMenuOpen(false)
                    onOpenImport()
                  }}
                >
                  批量导入(粘贴)
                </DropdownItem>
              </DropdownPortal>
            )}
          </div>
        </div>
      </header>

      {/* 分组选择器(窄屏才显示;宽屏时左侧已有独立分组栏) */}
      {!hideGroupSelector && (
        <GroupSelector
          groups={groups}
          selectedID={selectedGroupID}
          countsByGroup={countsByGroup}
          totalCount={totalAccountCount}
          label={currentGroupLabel}
          count={currentGroupCount}
          onSelect={onSelectGroup}
          onManage={onOpenGroupManager}
        />
      )}

      {/* 选中行动栏 / 排序栏 */}
      {hasSelection ? (
        <div className="flex items-center gap-1.5 border-b border-border bg-info/5 px-2 py-1.5 text-xs">
          <span className="font-medium text-info">已选 {selectedIDs.size}</span>
          <button
            type="button"
            onClick={onRefreshSelected}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 hover:bg-accent"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={copySelectedEmails}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 hover:bg-accent"
          >
            <Copy className="h-3 w-3" /> 复制
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 text-destructive hover:bg-destructive/20"
          >
            <Trash2 className="h-3 w-3" /> 删除
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            清空
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5 text-[11px] text-muted-foreground">
          <button
            type="button"
            onClick={onRefreshAll}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 hover:bg-accent"
          >
            刷新全部
          </button>
        </div>
      )}

      {/* 搜索 */}
      <div className="border-b border-border px-2 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索邮箱 / 备注 / 标签"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus:border-info"
          />
        </div>
      </div>

      {/* 排序模式 + 标签筛选 + 每页 N */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5 text-[11px]">
        <span className="text-muted-foreground">排序</span>
        <SortChip active={sortMode === 'order'} onClick={() => setSortMode('order')}>
          排序值
        </SortChip>
        <SortChip active={sortMode === 'created'} onClick={() => setSortMode('created')}>
          创建时间
        </SortChip>
        <SortChip active={sortMode === 'email'} onClick={() => setSortMode('email')}>
          邮箱名
        </SortChip>
        <span className="ml-2 text-muted-foreground">标签</span>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="h-6 rounded-md border border-border bg-background px-1.5 text-[11px] outline-none focus:border-info"
        >
          <option value="">全部标签</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
          className="ml-auto h-6 rounded-md border border-border bg-background px-1.5 text-[11px] outline-none focus:border-info"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              每页 {n}
            </option>
          ))}
        </select>
      </div>

      {/* 列表 */}
      <ul className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <li className="p-6 text-center text-xs text-muted-foreground">
            {accounts.length === 0 ? '还没有账号,点上方"+"添加' : '没有匹配的账号'}
          </li>
        ) : (
          filtered.map((a) => (
            <AccountItem
              key={a.id}
              account={a}
              active={a.id === selectedID}
              checked={selectedIDs.has(a.id)}
              refreshing={refreshingIDs.has(a.id)}
              onClick={() => onSelect(a.id)}
              onToggleSelect={() => onToggleSelect(a.id)}
              onEdit={() => onEditAccount(a)}
              onAfterChange={onAfterChange}
            />
          ))
        )}
      </ul>
    </section>
  )
}

function IconButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-info/15 text-info'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function SortChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2 text-[11px] transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'border border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function AccountItem({
  account,
  active,
  checked,
  refreshing,
  onClick,
  onToggleSelect,
  onEdit,
  onAfterChange,
}: {
  account: AccountView
  active: boolean
  checked: boolean
  refreshing: boolean
  onClick: () => void
  onToggleSelect: () => void
  onEdit: () => void
  onAfterChange: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const badge = STATUS_BADGE[account.status] ?? STATUS_BADGE.unknown

  const copyEmail = async () => {
    setMenuOpen(false)
    await navigator.clipboard.writeText(account.email)
  }
  const toggleDisabled = async () => {
    setMenuOpen(false)
    try {
      await outlookAPI.updateAccount(account.id, { disabled: !account.disabled })
      onAfterChange()
    } catch (e) {
      alert(String(e))
    }
  }
  const remove = async () => {
    setMenuOpen(false)
    if (!confirm(`删除账号「${account.email}」?`)) return
    try {
      await outlookAPI.deleteAccount(account.id)
      onAfterChange()
    } catch (e) {
      alert(String(e))
    }
  }

  return (
    <li
      onClick={onClick}
      className={cn(
        'group/row flex cursor-pointer items-center gap-2 border-b border-border/40 px-2 py-2 transition-colors',
        active ? 'bg-info/10' : 'hover:bg-accent/40',
        account.disabled && 'opacity-50',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggleSelect}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-info"
      />
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium',
          avatarStyle(account.email),
        )}
      >
        {avatarLetter(account.email)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-xs font-medium">{account.email}</span>
          {refreshing && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-info" />}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className={cn('rounded-sm border px-1 py-px', badge.cls)}>{badge.label}</span>
          {account.disabled && (
            <span className="rounded-sm border border-muted-foreground/40 bg-muted/40 px-1 py-px">已停用</span>
          )}
          {account.remark && <span className="truncate">· {account.remark}</span>}
          {account.has_proxy && <span className="text-info">· 代理</span>}
        </div>
      </div>
      {/* 三点菜单 */}
      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground',
            menuOpen ? 'opacity-100' : 'opacity-60 group-hover/row:opacity-100',
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <DropdownPortal onClose={() => setMenuOpen(false)}>
            <DropdownItem icon={<Copy className="h-3.5 w-3.5" />} onClick={copyEmail}>
              复制邮箱
            </DropdownItem>
            <DropdownItem
              icon={<Power className="h-3.5 w-3.5" />}
              onClick={toggleDisabled}
            >
              {account.disabled ? '启用账号' : '停用账号'}
            </DropdownItem>
            <DropdownItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
            >
              编辑账号
            </DropdownItem>
            <DropdownItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              danger
              onClick={remove}
            >
              删除账号
            </DropdownItem>
          </DropdownPortal>
        )}
      </div>
    </li>
  )
}

/**
 * 轻量下拉:相对 trigger 浮动定位 + 点击外部关闭
 * 这里用 absolute 而不是 portal,因为账号行有 overflow:auto,期望菜单跟随滚动
 * 但需要保证不被父容器 clip — 给一个较小的右对齐位置即可
 */
function DropdownPortal({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-full z-50 mt-1 min-w-[120px] overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
    >
      {children}
    </div>
  )
}

function DropdownItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        danger
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-accent',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/**
 * 分组选择器:替代原独立分组栏。
 * 显示一个 chip 样式的下拉触发器(当前分组名 + 计数),点击展开列表 + 管理入口。
 */
function GroupSelector({
  groups,
  selectedID,
  countsByGroup,
  totalCount,
  label,
  count,
  onSelect,
  onManage,
}: {
  groups: Group[]
  selectedID: string
  countsByGroup: Record<string, number>
  totalCount: number
  label: string
  count: number
  onSelect: (id: string) => void
  onManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative border-b border-border px-2 py-1.5" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs transition-colors hover:border-info/60 hover:bg-info/5',
          open && 'border-info/60 bg-info/5',
        )}
      >
        <span className="truncate font-medium">{label}</span>
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="absolute left-2 right-2 top-full z-50 mt-1 max-h-[60vh] overflow-auto rounded-md border border-border bg-card py-1 shadow-lg">
          <GroupOption
            label="全部"
            count={totalCount}
            active={selectedID === ''}
            onClick={() => {
              onSelect('')
              setOpen(false)
            }}
          />
          <div className="my-1 border-t border-border/60" />
          {groups.map((g) => (
            <GroupOption
              key={g.id}
              label={g.name}
              count={countsByGroup[g.id] ?? 0}
              active={selectedID === g.id}
              onClick={() => {
                onSelect(g.id)
                setOpen(false)
              }}
            />
          ))}
          <div className="my-1 border-t border-border/60" />
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
            管理分组
          </button>
        </div>
      )}
    </div>
  )
}

function GroupOption({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        active
          ? 'bg-info/15 font-medium text-info'
          : 'text-foreground/90 hover:bg-accent hover:text-foreground',
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 text-[10px] tabular-nums',
          active ? 'bg-info/20 text-info' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  )
}

