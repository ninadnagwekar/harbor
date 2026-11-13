import { dueMeta, formatDay, labelOf, PRIORITIES, TASK_STATUSES, dotOf } from "@/lib/labels"
import type { Task, TaskPatch, TaskStatus, UserBrief } from "@/lib/types"
import { selectClass } from "@/components/ui-bits"
import { cn } from "@/lib/utils"

export function ListView({
  tasks,
  members,
  showProject,
  onOpen,
  onPatch,
}: {
  tasks: Task[]
  members: UserBrief[]
  showProject?: boolean
  onOpen: (id: string) => void
  onPatch: (id: string, patch: TaskPatch) => void
}) {
  if (tasks.length === 0) {
    return <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">No tasks match these filters.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="hidden grid-cols-[1fr_140px_140px_120px_110px] gap-2 border-b px-3 py-2 text-xs text-muted-foreground md:grid">
        <span>Task</span>
        <span>Assignee</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Due</span>
      </div>
      {tasks.map((task) => {
        const due = dueMeta(task.due_date, task.status)
        return (
          <div key={task.id} className="grid items-center gap-2 border-b px-3 py-2 last:border-b-0 md:grid-cols-[1fr_140px_140px_120px_110px]">
            <button type="button" className="min-w-0 text-left" onClick={() => onOpen(task.id)}>
              <span className="flex items-center gap-2">
                <span className={cn("size-1.5 shrink-0 rounded-full", dotOf(PRIORITIES, task.priority))} />
                <span className="truncate text-sm font-medium">{task.title}</span>
                {task.task_type === "bug" ? <span className="text-[10px] font-semibold tracking-wide text-rose-600 uppercase">Bug</span> : null}
              </span>
              {showProject ? <span className="mt-0.5 block truncate pl-3.5 text-xs text-muted-foreground">{task.project_name}</span> : null}
            </button>
            <select
              className={selectClass("w-full")}
              value={task.assignee?.id ?? ""}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onPatch(task.id, { assignee_id: event.target.value || null })}
              aria-label={`Assignee for ${task.title}`}
            >
              <option value="">Unassigned</option>
              {members.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
              {task.assignee && !members.some((person) => person.id === task.assignee?.id) ? (
                <option value={task.assignee.id}>{task.assignee.name}</option>
              ) : null}
            </select>
            <select
              className={selectClass("w-full")}
              value={task.status}
              onChange={(event) => onPatch(task.id, { status: event.target.value as TaskStatus })}
              aria-label={`Status for ${task.title}`}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
            <span className="hidden text-sm text-muted-foreground capitalize md:block">{labelOf(PRIORITIES, task.priority)}</span>
            <span className={cn("text-sm", due?.overdue ? "font-medium text-rose-600" : "text-muted-foreground")}>
              {due?.text ?? formatDay(task.due_date)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
