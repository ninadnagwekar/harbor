import { useState } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { PRIORITIES, TASK_STATUSES, TYPE_ACCENT, dotOf, dueMeta } from "@/lib/labels"
import type { Task, TaskStatus } from "@/lib/types"
import { Person } from "@/components/ui-bits"
import { cn } from "@/lib/utils"

function Card({ task, overlay = false, onOpen }: { task: Task; overlay?: boolean; onOpen?: (id: string) => void }) {
  const due = dueMeta(task.due_date, task.status)
  return (
    <div
      className={cn(
        "rounded-xl border border-l-[3px] bg-card px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
        TYPE_ACCENT[task.task_type],
        overlay && "w-64 rotate-1 shadow-lg",
      )}
    >
      <button type="button" className="w-full text-left" onClick={() => onOpen?.(task.id)}>
        <p className="text-sm leading-snug font-medium">{task.title}</p>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {task.task_type === "bug" ? <span className="text-[10px] font-semibold tracking-wide text-rose-600 uppercase">Bug</span> : null}
          {task.task_type === "feature" ? <span className="text-[10px] font-semibold tracking-wide text-indigo-600 uppercase">Feature</span> : null}
          <span className={cn("size-1.5 rounded-full", dotOf(PRIORITIES, task.priority))} />
          <span className="text-[11px] text-muted-foreground capitalize">{task.priority}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {due ? <span className={cn("text-[11px]", due.overdue ? "font-medium text-rose-600" : "text-muted-foreground")}>{due.text}</span> : null}
          {task.assignee ? <Person id={task.assignee.id} name={task.assignee.name} className="size-5 text-[9px]" /> : null}
        </div>
      </div>
    </div>
  )
}

function DraggableCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task } })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn(isDragging && "opacity-40")}>
      <Card task={task} onOpen={onOpen} />
    </div>
  )
}

function Column({
  status,
  tasks,
  onOpen,
  onQuickAdd,
}: {
  status: (typeof TASK_STATUSES)[number]
  tasks: Task[]
  onOpen: (id: string) => void
  onQuickAdd: (status: TaskStatus, title: string) => Promise<void>
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status.id}` })
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const next = title.trim()
    if (!next) {
      setAdding(false)
      return
    }
    setBusy(true)
    try {
      await onQuickAdd(status.id, next)
      setTitle("")
      setAdding(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex h-full w-72 shrink-0 flex-col">
      <header className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("size-2 rounded-full", status.dot)} />
        <h2 className="text-sm font-medium">{status.label}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
      </header>
      <div
        ref={setNodeRef}
        className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl bg-muted/40 p-2", isOver && "bg-harbor-soft")}
      >
        {tasks.map((task) => (
          <DraggableCard key={task.id} task={task} onOpen={onOpen} />
        ))}
        {tasks.length === 0 ? <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing here</p> : null}
        {adding ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                if (!title.trim() && !busy) setAdding(false)
              }}
              placeholder="Task title"
              className="h-8 w-full rounded-lg border bg-card px-2 text-sm outline-none"
              disabled={busy}
            />
          </form>
        ) : (
          <button type="button" className="rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-card" onClick={() => setAdding(true)}>
            Add a task
          </button>
        )}
      </div>
    </section>
  )
}

export function Board({
  tasks,
  onOpen,
  onStatus,
  onQuickAdd,
}: {
  tasks: Task[]
  onOpen: (id: string) => void
  onStatus: (id: string, status: TaskStatus) => void
  onQuickAdd: (status: TaskStatus, title: string) => Promise<void>
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [active, setActive] = useState<Task | null>(null)

  const onDragStart = (event: DragStartEvent) => {
    const task = tasks.find((item) => item.id === event.active.id)
    setActive(task ?? null)
  }
  const onDragEnd = (event: DragEndEvent) => {
    setActive(null)
    const over = event.over?.id
    if (typeof over !== "string" || !over.startsWith("col:")) return
    const status = over.slice(4) as TaskStatus
    const task = tasks.find((item) => item.id === event.active.id)
    if (task && task.status !== status) onStatus(task.id, status)
  }

  const order = ["todo", "in_progress", "in_review", "blocked", "done", "backlog"] as const
  const columns = order
    .map((id) => TASK_STATUSES.find((status) => status.id === id))
    .filter((status) => status && (status.id !== "backlog" || tasks.some((task) => task.status === "backlog")))

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-[calc(100svh-13.5rem)] min-h-[28rem] gap-3 overflow-x-auto pb-2">
        {columns.map((status) =>
          status ? (
            <Column
              key={status.id}
              status={status}
              tasks={tasks.filter((task) => task.status === status.id)}
              onOpen={onOpen}
              onQuickAdd={onQuickAdd}
            />
          ) : null,
        )}
      </div>
      <DragOverlay>{active ? <Card task={active} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}
