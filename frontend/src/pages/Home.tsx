import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, RotateCcw } from 'lucide-react'
import {
  CATEGORY_LABELS,
  getAllTools,
  isVisible,
  useToolsStore,
  type ToolMeta,
} from '@/stores/tools'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function Home() {
  const visibility = useToolsStore((s) => s.visibility)
  const order = useToolsStore((s) => s.order)
  const setOrder = useToolsStore((s) => s.setOrder)
  const setVisibility = useToolsStore((s) => s.setVisibility)
  const resetOrder = useToolsStore((s) => s.resetOrder)

  const allTools = useMemo(() => getAllTools(order), [order])
  const [isManaging, setIsManaging] = useState(false)

  const displayedTools = isManaging
    ? allTools
    : allTools.filter((t) => isVisible(t.id, visibility, t.defaultVisible))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = allTools.map((t) => t.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    setOrder(arrayMove(ids, oldIndex, newIndex))
  }

  const visibleCount = allTools.filter((t) =>
    isVisible(t.id, visibility, t.defaultVisible)
  ).length

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tool Forge</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isManaging
              ? `全部 ${allTools.length} 个工具 · 拖动卡片排序，点击开关启用 / 隐藏`
              : `共 ${visibleCount} 个工具 · 拖动卡片可调整顺序`}
          </p>
        </div>
        <div className="flex gap-2">
          {isManaging && order.length > 0 && (
            <Button variant="ghost" size="sm" onClick={resetOrder}>
              <RotateCcw className="h-3.5 w-3.5" />
              重置顺序
            </Button>
          )}
          <Button
            variant={isManaging ? 'default' : 'outline'}
            size="sm"
            onClick={() => setIsManaging((v) => !v)}
          >
            {isManaging ? '完成' : '管理'}
          </Button>
        </div>
      </header>

      {displayedTools.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          没有启用的工具，点右上角「管理」开启一些吧
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayedTools.map((t) => t.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {displayedTools.map((tool) => (
                <SortableCard
                  key={tool.id}
                  tool={tool}
                  visible={isVisible(tool.id, visibility, tool.defaultVisible)}
                  managing={isManaging}
                  onToggle={(v) => setVisibility(tool.id, v)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

function SortableCard({
  tool,
  visible,
  managing,
  onToggle,
}: {
  tool: ToolMeta
  visible: boolean
  managing: boolean
  onToggle: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tool.id })

  const Icon = tool.icon
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // 管理模式下点击卡片不导航（避免误触）；浏览模式下点击导航
  // 拖动由 dnd-kit 的 distance:5 约束区分 —— 挪动 <5px 是点击，≥5px 才进入拖动
  const handleClick = () => {
    if (managing) return
    navigate(tool.path)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleClick}
      {...attributes}
      {...listeners}
      className={cn(
        'group relative rounded-lg border border-border bg-card p-4 transition-colors touch-none',
        !managing && 'cursor-pointer hover:border-foreground/20 hover:bg-accent',
        managing && 'cursor-grab active:cursor-grabbing',
        !visible && 'opacity-50',
        isDragging && 'z-10 cursor-grabbing shadow-lg'
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{tool.title}</div>
          <div className="text-[11px] text-muted-foreground">
            {CATEGORY_LABELS[tool.category]}
          </div>
        </div>
        {managing && (
          <div
            className="flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <VisibilitySwitch checked={visible} onChange={onToggle} />
            <GripVertical className="h-4 w-4 text-muted-foreground/60" />
          </div>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground line-clamp-2">
        {tool.description}
      </p>
    </div>
  )
}

function VisibilitySwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted'
      )}
      title={checked ? '点击隐藏' : '点击显示'}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}
