import { useState } from "react"
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns"
import { Button } from "@/components/ui/button"
import { TYPE_ACCENT } from "@/lib/labels"
import type { Task } from "@/lib/types"
import { cn } from "@/lib/utils"

function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd")
}

function Pill({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={() => onOpen(task.id)}
      className={cn(
        "block w-full truncate rounded-md border border-l-2 bg-card px-1.5 py-0.5 text-left text-[11px]",
        TYPE_ACCENT[task.task_type],
        task.task_type === "bug" && "text-rose-700",
        task.priority === "critical" && "font-medium",
        isDragging && "opacity-40",
      )}
    >
      {task.title}
    </button>
  )
}

function DayCell({
  date,
  tasks,
  muted,
  onOpen,
}: {
  date: Date
  tasks: Task[]
  muted?: boolean
  onOpen: (id: string) => void
}) {
  const key = dayKey(date)
  const { setNodeRef, isOver } = useDroppable({ id: `day:${key}` })
  const today = dayKey(new Date()) === key
  return (
    <div
      ref={setNodeRef}
      className={cn("min-h-28 border-r border-b p-1.5", muted && "bg-muted/30", isOver && "bg-harbor-soft")}
    >
      <div className={cn("mb-1 text-xs", today ? "font-semibold text-harbor" : "text-muted-foreground")}>{format(date, "d")}</div>
      <div className="grid gap-1">
        {tasks.slice(0, 4).map((task) => (
          <Pill key={task.id} task={task} onOpen={onOpen} />
        ))}
        {tasks.length > 4 ? <p className="text-[11px] text-muted-foreground">+{tasks.length - 4} more</p> : null}
      </div>
    </div>
  )
}

export function CalendarView({
  tasks,
  onOpen,
  onDue,
}: {
  tasks: Task[]
  onOpen: (id: string) => void
  onDue: (id: string, due: string) => void
}) {
  const [mode, setMode] = useState<"month" | "week">("month")
  const [anchor, setAnchor] = useState(() => new Date())
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const days =
    mode === "month"
      ? eachDayOfInterval({
          start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
          end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
        })
      : eachDayOfInterval({
          start: startOfWeek(anchor, { weekStartsOn: 1 }),
          end: endOfWeek(anchor, { weekStartsOn: 1 }),
        })

  const byDay = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.due_date) continue
    const list = byDay.get(task.due_date) ?? []
    list.push(task)
    byDay.set(task.due_date, list)
  }
  const undated = tasks.filter((task) => !task.due_date)

  const onDragEnd = (event: DragEndEvent) => {
    const over = event.over?.id
    if (typeof over !== "string" || !over.startsWith("day:")) return
    const due = over.slice(4)
    const task = tasks.find((item) => item.id === String(event.active.id))
    if (task && task.due_date !== due) onDue(task.id, due)
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAnchor((date) => (mode === "month" ? addMonths(date, -1) : addWeeks(date, -1)))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor((date) => (mode === "month" ? addMonths(date, 1) : addWeeks(date, 1)))}>
            Next
          </Button>
          <p className="text-sm font-medium">{mode === "month" ? format(anchor, "MMMM yyyy") : `Week of ${format(startOfWeek(anchor, { weekStartsOn: 1 }), "d MMM")}`}</p>
        </div>
        <div className="flex rounded-lg border bg-card p-0.5">
          {(["month", "week"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={cn("rounded-md px-2.5 py-1 text-sm capitalize", mode === item && "bg-muted font-medium")}
              onClick={() => setMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b text-center text-[11px] text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div key={day} className="px-1 py-2">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((date) => (
            <DayCell
              key={dayKey(date)}
              date={date}
              tasks={byDay.get(dayKey(date)) ?? []}
              muted={mode === "month" && !isSameMonth(date, anchor)}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
      {undated.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-muted-foreground">No due date — drag onto a day</p>
          <div className="flex flex-wrap gap-2">
            {undated.map((task) => (
              <div key={task.id} className="w-48">
                <Pill task={task} onOpen={onOpen} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </DndContext>
  )
}
