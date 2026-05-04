import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Pencil, MessageSquare } from 'lucide-react'
import type { ConversationSummary } from './types'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'

interface Props {
  list: ConversationSummary[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onEdit: (id: string) => void
}

interface MenuState {
  id: string
  x: number
  y: number
}

export function ConversationList({
  list,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onEdit,
}: Props) {
  const dialog = useConfirm()
  const [menu, setMenu] = useState<MenuState | null>(null)

  const askDelete = async (c: ConversationSummary) => {
    const ok = await dialog({
      title: '删除会话',
      message: `确认删除「${c.title}」?该会话所有消息都会丢失。`,
      danger: true,
      confirmLabel: '删除',
    })
    if (ok) onDelete(c.id)
  }

  const openMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setMenu({ id, x: e.clientX, y: e.clientY })
  }

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-3">
        <Button onClick={onNew} size="sm" className="w-full">
          <Plus className="h-3.5 w-3.5" />
          新建对话
        </Button>
      </div>
      <ul className="flex-1 overflow-auto px-2 py-2">
        {list.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            还没有对话,点上方「新建」开始
          </li>
        ) : (
          list.map((c) => (
            <li
              key={c.id}
              onClick={() => onSelect(c.id)}
              onContextMenu={(e) => openMenu(e, c.id)}
              className={cn(
                'mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
                activeId === c.id ? 'bg-info/15 text-info' : 'hover:bg-secondary',
              )}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={c.title}>
                {c.title}
              </span>
            </li>
          ))
        )}
      </ul>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onEdit={() => {
            onEdit(menu.id)
            setMenu(null)
          }}
          onDelete={() => {
            const c = list.find((x) => x.id === menu.id)
            setMenu(null)
            if (c) void askDelete(c)
          }}
        />
      )}
    </aside>
  )
}

function ContextMenu({
  x,
  y,
  onClose,
  onEdit,
  onDelete,
}: {
  x: number
  y: number
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // 点击外部 / Esc 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 防溢出:估算菜单尺寸
  const W = 160
  const H = 76
  const left = Math.min(x, window.innerWidth - W - 4)
  const top = Math.min(y, window.innerHeight - H - 4)

  return createPortal(
    <div
      ref={ref}
      style={{ left, top }}
      className="fixed z-[80] w-40 overflow-hidden rounded-md border border-border bg-popover py-1 text-sm shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={onEdit}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-secondary"
      >
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        编辑
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-destructive transition-colors hover:bg-destructive/10"
      >
        <Trash2 className="h-3.5 w-3.5" />
        删除
      </button>
    </div>,
    document.body,
  )
}
