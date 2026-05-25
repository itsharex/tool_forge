import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FolderPlus, Pencil, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { outlookAPI } from './api'
import type { Group } from './types'

export function GroupManagerDialog({
  groups,
  countsByGroup,
  onClose,
  onChanged,
}: {
  groups: Group[]
  countsByGroup: Record<string, number>
  onClose: () => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const startEdit = (g: Group) => {
    setEditing(g.id)
    setEditValue(g.name)
  }
  const submitEdit = async () => {
    if (!editing) return
    if (editValue.trim()) {
      try {
        await outlookAPI.renameGroup(editing, editValue.trim())
        onChanged()
      } catch (e) {
        alert(String(e))
      }
    }
    setEditing(null)
  }
  const submitNew = async () => {
    const name = newName.trim()
    if (!name) {
      setAdding(false)
      return
    }
    try {
      await outlookAPI.addGroup(name)
      onChanged()
    } catch (e) {
      alert(String(e))
    }
    setNewName('')
    setAdding(false)
  }
  const remove = async (g: Group) => {
    if (g.id === 'default') return
    if (!confirm(`删除分组「${g.name}」?该分组下的账号会迁移到默认分组。`)) return
    try {
      await outlookAPI.deleteGroup(g.id)
      onChanged()
    } catch (e) {
      alert(String(e))
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-[480px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className="text-sm font-semibold">管理分组</h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-3">
          {groups.map((g) => (
            <div
              key={g.id}
              className="group/row flex items-center gap-2 rounded-md border border-border bg-muted/20 p-2"
            >
              {editing === g.id ? (
                <>
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitEdit()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-info"
                    autoFocus
                  />
                  <IconBtn onClick={submitEdit} title="保存" variant="success">
                    <Check className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn onClick={() => setEditing(null)} title="取消">
                    <X className="h-3.5 w-3.5" />
                  </IconBtn>
                </>
              ) : (
                <>
                  <span className="flex-1 truncate text-xs font-medium">{g.name}</span>
                  <span className="rounded-full bg-muted px-2 text-[10px] text-muted-foreground">
                    {countsByGroup[g.id] ?? 0}
                  </span>
                  <IconBtn onClick={() => startEdit(g)} title="重命名">
                    <Pencil className="h-3.5 w-3.5" />
                  </IconBtn>
                  {g.id !== 'default' && (
                    <IconBtn onClick={() => remove(g)} title="删除" variant="danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  )}
                </>
              )}
            </div>
          ))}

          {adding ? (
            <div className="flex items-center gap-2 rounded-md border border-info/40 bg-info/5 p-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNew()
                  if (e.key === 'Escape') {
                    setNewName('')
                    setAdding(false)
                  }
                }}
                placeholder="新分组名"
                className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-info"
                autoFocus
              />
              <IconBtn onClick={submitNew} title="保存" variant="success">
                <Check className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                onClick={() => {
                  setNewName('')
                  setAdding(false)
                }}
                title="取消"
              >
                <X className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground transition-colors hover:border-info hover:text-info"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              新增分组
            </button>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-2.5">
          <p className="mr-auto text-[11px] text-muted-foreground">
            共 {groups.length} 个分组
          </p>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            完成
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function IconBtn({
  children,
  onClick,
  title,
  variant,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  variant?: 'success' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
        variant === 'success' && 'text-success hover:bg-success/10',
        variant === 'danger' && 'text-muted-foreground hover:bg-destructive/15 hover:text-destructive',
        !variant && 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
