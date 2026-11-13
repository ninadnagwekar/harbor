import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ErrorState, PageLoading, Person } from "@/components/ui-bits"
import { NotesPanel } from "@/components/notes-panel"
import { TestCasesPanel } from "@/components/test-cases-panel"
import { ProjectForm, type ProjectDraft } from "@/components/project-form"
import { Board } from "@/components/tasks/board"
import { CalendarView } from "@/components/tasks/calendar-view"
import { TaskFilters, filterTasks } from "@/components/tasks/filters"
import { ListView } from "@/components/tasks/list-view"
import { TableView } from "@/components/tasks/table-view"
import { TaskDialog, type TaskDraft } from "@/components/tasks/task-dialog"
import { TaskDrawer } from "@/components/tasks/task-drawer"
import { ApiError, api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { PRIORITIES, PROJECT_STATUSES, dotOf, formatDay, labelOf } from "@/lib/labels"
import type { Project, Task, TaskPatch, TaskStatus, TeamMember } from "@/lib/types"
import { emptyFilters, type Filters } from "@/lib/types"
import { cn } from "@/lib/utils"

const VIEWS = [
  { id: "status", label: "Status" },
  { id: "list", label: "List" },
  { id: "table", label: "Table" },
  { id: "calendar", label: "Calendar" },
  { id: "notes", label: "Notes" },
  { id: "tests", label: "Test cases" },
]

function payload(draft: ProjectDraft) {
  return {
    name: draft.name,
    description: draft.description,
    owner_id: draft.owner_id,
    status: draft.status,
    priority: draft.priority,
    start_date: draft.start_date || null,
    target_date: draft.target_date || null,
    tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    member_ids: draft.member_ids,
  }
}

export function ProjectPage() {
  const { projectId = "" } = useParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const view = params.get("view") || "status"
  const taskId = params.get("task")
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/api/projects/${projectId}`),
  })
  const tasks = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api<Task[]>(`/api/tasks?project_id=${projectId}`),
  })
  const team = useQuery({
    queryKey: ["team"],
    queryFn: () => api<TeamMember[]>("/api/team"),
    enabled: user?.role === "admin",
  })

  const filtered = useMemo(() => filterTasks(tasks.data ?? [], filters), [tasks.data, filters])
  const openTask = (tasks.data ?? []).find((task) => task.id === taskId) ?? null

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] })
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] })
    void queryClient.invalidateQueries({ queryKey: ["projects"] })
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    void queryClient.invalidateQueries({ queryKey: ["notifications"] })
  }

  const patchTask = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      api<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks", projectId] })
      const previous = queryClient.getQueryData<Task[]>(["tasks", projectId])
      queryClient.setQueryData<Task[]>(["tasks", projectId], (current) =>
        current?.map((task) =>
          task.id === id
            ? {
                ...task,
                ...patch,
                overdue: patch.status === "done" ? false : task.overdue,
              }
            : task,
        ),
      )
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["tasks", projectId], context.previous)
      toast.error(err instanceof ApiError ? err.message : "Could not update the task.")
    },
    onSettled: invalidate,
  })

  const createTask = useMutation({
    mutationFn: (draft: TaskDraft) =>
      api(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: draft.title,
          description: draft.description,
          task_type: draft.task_type,
          status: draft.status,
          priority: draft.priority,
          assignee_id: draft.assignee_id || null,
          due_date: draft.due_date || null,
          estimate_hours: draft.estimate_hours ? Number(draft.estimate_hours) : null,
          tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          severity: draft.task_type === "bug" ? draft.severity : null,
          steps_to_reproduce: draft.steps_to_reproduce,
          expected_result: draft.expected_result,
          actual_result: draft.actual_result,
        }),
      }),
    onSuccess: () => {
      setCreating(false)
      toast.success("Task created")
      invalidate()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create the task."),
  })

  const saveProject = useMutation({
    mutationFn: (draft: ProjectDraft) => api(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(payload(draft)) }),
    onSuccess: () => {
      setEditing(false)
      toast.success("Project updated")
      invalidate()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update the project."),
  })

  const archive = useMutation({
    mutationFn: (archived: boolean) => api(`/api/projects/${projectId}/archive?archived=${archived}`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Project updated")
      invalidate()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update the project."),
  })

  const remove = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Project deleted")
      window.location.assign("/projects")
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not delete the project."),
  })

  const setView = (next: string) => {
    const copy = new URLSearchParams(params)
    copy.set("view", next)
    setParams(copy, { replace: true })
  }
  const open = (id: string) => {
    const copy = new URLSearchParams(params)
    copy.set("task", id)
    setParams(copy)
  }
  const close = () => {
    const copy = new URLSearchParams(params)
    copy.delete("task")
    setParams(copy, { replace: true })
  }

  if (project.isLoading || tasks.isLoading) return <PageLoading />
  if (project.isError || !project.data) {
    return <ErrorState message={project.error instanceof ApiError ? project.error.message : "This project is not available."} onRetry={() => void project.refetch()} />
  }

  const current = project.data
  const members = current.members
  const onPatch = (id: string, patch: TaskPatch) => patchTask.mutate({ id, patch })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link to="/projects" className="hover:underline">Projects</Link>
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{current.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", dotOf(PROJECT_STATUSES, current.status))} />
              {labelOf(PROJECT_STATUSES, current.status)}
            </span>
            <span>· {labelOf(PRIORITIES, current.priority)}</span>
            <span>· {current.progress}% done</span>
            <span>· Target {formatDay(current.target_date)}</span>
            <span className="inline-flex items-center gap-1">
              · <Person id={current.owner.id} name={current.owner.name} className="size-5" /> {current.owner.name}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view !== "notes" && view !== "tests" ? <Button onClick={() => setCreating(true)}>New task</Button> : null}
          {user?.role === "admin" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Project</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(true)}>Edit details</DropdownMenuItem>
                <DropdownMenuItem onClick={() => archive.mutate(!current.archived)}>
                  {current.archived ? "Restore" : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => remove.mutate()}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {current.description ? <p className="max-w-3xl text-sm text-muted-foreground">{current.description}</p> : null}
      <div className="flex gap-1 overflow-x-auto border-b">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              view === item.id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {view !== "notes" && view !== "tests" ? <TaskFilters filters={filters} members={members} onChange={setFilters} showStatus={view !== "status"} /> : null}
      {tasks.isError ? <ErrorState message="Tasks could not be loaded." onRetry={() => void tasks.refetch()} /> : null}
      {view === "status" ? (
        <Board
          tasks={filtered}
          onOpen={open}
          onStatus={(id, status) => onPatch(id, { status })}
          onQuickAdd={async (status: TaskStatus, title: string) => {
            await api(`/api/projects/${projectId}/tasks`, {
              method: "POST",
              body: JSON.stringify({ title, status, task_type: "task", priority: "medium" }),
            })
            invalidate()
          }}
        />
      ) : null}
      {view === "list" ? <ListView tasks={filtered} members={members} onOpen={open} onPatch={onPatch} /> : null}
      {view === "table" ? (
        <TableView
          tasks={filtered}
          members={members}
          onOpen={open}
          onPatch={onPatch}
          onBulk={async (ids, patch) => {
            await api("/api/tasks/bulk", { method: "POST", body: JSON.stringify({ ids, ...patch }) })
            invalidate()
          }}
        />
      ) : null}
      {view === "calendar" ? <CalendarView tasks={filtered} onOpen={open} onDue={(id, due_date) => onPatch(id, { due_date })} /> : null}
      {view === "notes" ? <NotesPanel projectId={projectId} /> : null}
      {view === "tests" ? <TestCasesPanel projectId={projectId} /> : null}
      <TaskDialog
        open={creating}
        members={members}
        busy={createTask.isPending}
        onOpenChange={setCreating}
        onCreate={async (draft) => {
          try {
            await createTask.mutateAsync(draft)
          } catch {
            /* toasted by the mutation */
          }
        }}
      />
      <ProjectForm
        open={editing}
        project={current}
        people={(team.data ?? []).map((member) => member.user)}
        currentUserId={user?.id ?? ""}
        busy={saveProject.isPending}
        onOpenChange={setEditing}
        onSave={async (draft) => {
          await saveProject.mutateAsync(draft)
        }}
      />
      <TaskDrawer task={openTask} onClose={close} />
    </div>
  )
}
