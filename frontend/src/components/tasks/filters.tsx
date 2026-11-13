import { Input } from "@/components/ui/input"
import { selectClass } from "@/components/ui-bits"
import { PRIORITIES, TASK_STATUSES, TASK_TYPES } from "@/lib/labels"
import type { Filters, UserBrief } from "@/lib/types"

export function TaskFilters({
  filters,
  members,
  onChange,
  showStatus = false,
}: {
  filters: Filters
  members: UserBrief[]
  onChange: (next: Filters) => void
  showStatus?: boolean
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const active = filters.q || filters.assignee !== "all" || filters.priority !== "all" || filters.type !== "all" || filters.status !== "all" || filters.overdue
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={filters.q}
        onChange={(event) => set({ q: event.target.value })}
        placeholder="Filter tasks"
        className="w-full sm:w-52"
        aria-label="Filter tasks"
      />
      <select className={selectClass()} value={filters.assignee} onChange={(event) => set({ assignee: event.target.value })} aria-label="Assignee">
        <option value="all">Anyone</option>
        <option value="none">Unassigned</option>
        {members.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      <select className={selectClass()} value={filters.priority} onChange={(event) => set({ priority: event.target.value })} aria-label="Priority">
        <option value="all">Any priority</option>
        {PRIORITIES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <select className={selectClass()} value={filters.type} onChange={(event) => set({ type: event.target.value })} aria-label="Type">
        <option value="all">Any type</option>
        {TASK_TYPES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {showStatus ? (
        <select className={selectClass()} value={filters.status} onChange={(event) => set({ status: event.target.value })} aria-label="Status">
          <option value="all">Any status</option>
          {TASK_STATUSES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      ) : null}
      <label className="flex h-8 items-center gap-1.5 rounded-lg px-1 text-sm text-muted-foreground">
        <input type="checkbox" checked={filters.overdue} onChange={(event) => set({ overdue: event.target.checked })} />
        Overdue
      </label>
      {active ? (
        <button type="button" className="text-sm text-muted-foreground underline" onClick={() => onChange({ q: "", assignee: "all", priority: "all", type: "all", status: "all", overdue: false })}>
          Clear
        </button>
      ) : null}
    </div>
  )
}

export function filterTasks<T extends { title: string; description: string; assignee: { id: string } | null; priority: string; task_type: string; status: string; overdue: boolean }>(
  tasks: T[],
  filters: Filters,
) {
  const query = filters.q.trim().toLowerCase()
  return tasks.filter((task) => {
    if (query && !task.title.toLowerCase().includes(query) && !task.description.toLowerCase().includes(query)) return false
    if (filters.assignee === "none" && task.assignee) return false
    if (filters.assignee !== "all" && filters.assignee !== "none" && task.assignee?.id !== filters.assignee) return false
    if (filters.priority !== "all" && task.priority !== filters.priority) return false
    if (filters.type !== "all" && task.task_type !== filters.type) return false
    if (filters.status !== "all" && task.status !== filters.status) return false
    if (filters.overdue && !task.overdue) return false
    return true
  })
}
