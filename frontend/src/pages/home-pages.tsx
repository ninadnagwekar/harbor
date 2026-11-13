import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState, ErrorState, PageLoading, Person, selectClass } from "@/components/ui-bits"
import { ProjectForm, type ProjectDraft } from "@/components/project-form"
import { TaskFilters, filterTasks } from "@/components/tasks/filters"
import { ListView } from "@/components/tasks/list-view"
import { TaskDrawer } from "@/components/tasks/task-drawer"
import { ApiError, api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { PRIORITIES, PROJECT_STATUSES, dotOf, dueMeta, formatDay, formatWhen, labelOf } from "@/lib/labels"
import type { Dashboard, Notice, Project, Task, TaskPatch, TeamMember } from "@/lib/types"
import { emptyFilters } from "@/lib/types"
import { cn } from "@/lib/utils"

const COUNTS: { key: keyof Dashboard["counts"]; label: string }[] = [
  { key: "active_projects", label: "Active projects" },
  { key: "completed_projects", label: "Completed" },
  { key: "on_hold_projects", label: "On hold" },
  { key: "open_tasks", label: "Open tasks" },
  { key: "in_progress_tasks", label: "In progress" },
  { key: "overdue_tasks", label: "Overdue" },
  { key: "open_bugs", label: "Open bugs" },
  { key: "assigned_to_me", label: "Assigned to me" },
]

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/api/dashboard") })
  const sample = useMutation({
    mutationFn: () => api<{ created: boolean; project_id: string }>("/api/admin/sample-workspace", { method: "POST" }),
    onSuccess: (result) => {
      toast.success(result.created ? "Sample workspace added" : "Sample workspace is already here")
      void queryClient.invalidateQueries()
      navigate(`/projects/${result.project_id}`)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not load the sample."),
  })

  if (dashboard.isLoading) return <PageLoading />
  if (dashboard.isError || !dashboard.data) {
    return <ErrorState message="The dashboard could not be loaded." onRetry={() => void dashboard.refetch()} />
  }
  const data = dashboard.data
  const empty = data.projects.length === 0 && data.counts.open_tasks === 0

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Good to see you, {user?.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">What is moving, what is late, and what is yours.</p>
        </div>
        {user?.role === "admin" && empty ? (
          <Button variant="outline" onClick={() => sample.mutate()} disabled={sample.isPending}>
            {sample.isPending ? "Loading…" : "Load a sample workspace"}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {COUNTS.map((item) => (
          <div key={item.key} className="rounded-xl border bg-card px-3 py-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", item.key === "overdue_tasks" && data.counts.overdue_tasks > 0 && "text-rose-600")}>
              {data.counts[item.key]}
            </p>
          </div>
        ))}
      </div>
      {empty ? (
        <EmptyState
          title="Nothing is in motion yet"
          body="Create a project and assign the people who will work on it. Or load a sample workspace to see the board filled in."
          action={<Button onClick={() => navigate("/projects")}>Create a project</Button>}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
          <section className="grid gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Projects</h2>
              <Link to="/projects" className="text-sm text-muted-foreground hover:underline">All projects</Link>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {data.projects.map((project) => (
                <Link key={project.id} to={`/projects/${project.id}`} className="rounded-xl border bg-card p-4 hover:border-foreground/20">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-medium">{project.name}</h3>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn("size-1.5 rounded-full", dotOf(PROJECT_STATUSES, project.status))} />
                      {labelOf(PROJECT_STATUSES, project.status)}
                    </span>
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Person id={project.owner.id} name={project.owner.name} className="size-5" />
                    {project.owner.name} · Target {formatDay(project.target_date)}
                  </p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-harbor" style={{ width: `${project.progress}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {project.progress}% · {project.open_tasks} open
                    {project.overdue_tasks ? ` · ${project.overdue_tasks} overdue` : ""}
                  </p>
                </Link>
              ))}
            </div>
            <h2 className="mt-2 text-sm font-medium">Project health</h2>
            <div className="overflow-hidden rounded-xl border bg-card">
              {data.health.map((item) => (
                <Link key={item.id} to={`/projects/${item.id}`} className="grid grid-cols-[1fr_120px_80px] items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
                  <span className="truncate">{item.name}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full bg-harbor" style={{ width: `${item.progress}%` }} />
                  </span>
                  <span className={cn("text-right text-xs", item.overdue_tasks ? "text-rose-600" : "text-muted-foreground")}>
                    {item.overdue_tasks ? `${item.overdue_tasks} late` : `${item.progress}%`}
                  </span>
                </Link>
              ))}
            </div>
          </section>
          <div className="grid content-start gap-6">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">My tasks</h2>
                <Link to="/my-tasks" className="text-sm text-muted-foreground hover:underline">View all</Link>
              </div>
              <div className="grid gap-2">
                {data.my_tasks.map((task) => {
                  const due = dueMeta(task.due_date, task.status)
                  return (
                    <Link key={task.id} to={`/projects/${task.project_id}?task=${task.id}`} className="rounded-xl border bg-card px-3 py-2 hover:border-foreground/20">
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {task.project_name}
                        {due ? <span className={due.overdue ? "text-rose-600" : ""}> · {due.text}</span> : null}
                      </p>
                    </Link>
                  )
                })}
                {data.my_tasks.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is assigned to you.</p> : null}
              </div>
            </section>
            <section>
              <h2 className="mb-2 text-sm font-medium">Upcoming deadlines</h2>
              <div className="grid gap-2">
                {data.upcoming.map((task) => (
                  <Link key={task.id} to={`/projects/${task.project_id}?task=${task.id}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{task.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDay(task.due_date)}</span>
                  </Link>
                ))}
                {data.upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No deadlines in the next week.</p> : null}
              </div>
            </section>
            <section>
              <h2 className="mb-2 text-sm font-medium">Recent activity</h2>
              <ol className="grid gap-2">
                {data.activity.map((item) => (
                  <li key={item.id} className="text-sm">
                    <p>{item.summary}</p>
                    <p className="text-xs text-muted-foreground">{formatWhen(item.created_at)}</p>
                  </li>
                ))}
                {data.activity.length === 0 ? <p className="text-sm text-muted-foreground">Activity will show up as the team works.</p> : null}
              </ol>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const q = params.get("q") ?? ""
  const status = params.get("status") ?? ""
  const archived = params.get("archived") === "1"
  const projects = useQuery({
    queryKey: ["projects", q, status, archived],
    queryFn: () => {
      const search = new URLSearchParams()
      if (q) search.set("q", q)
      if (status) search.set("status", status)
      if (archived) search.set("archived", "true")
      const suffix = search.toString()
      return api<Project[]>(`/api/projects${suffix ? `?${suffix}` : ""}`)
    },
  })
  const team = useQuery({
    queryKey: ["team"],
    queryFn: () => api<TeamMember[]>("/api/team"),
    enabled: user?.role === "admin",
  })
  const create = useMutation({
    mutationFn: (draft: ProjectDraft) =>
      api<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          owner_id: draft.owner_id,
          status: draft.status,
          priority: draft.priority,
          start_date: draft.start_date || null,
          target_date: draft.target_date || null,
          tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          member_ids: draft.member_ids,
        }),
      }),
    onSuccess: (project) => {
      setOpen(false)
      toast.success("Project created")
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
      window.location.assign(`/projects/${project.id}`)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create the project."),
  })
  const sample = useMutation({
    mutationFn: () => api("/api/admin/sample-workspace", { method: "POST" }),
    onSuccess: () => {
      toast.success("Sample workspace added")
      void queryClient.invalidateQueries()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not load the sample."),
  })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Each project keeps its tasks, notes, and people together.</p>
        </div>
        {user?.role === "admin" ? <Button onClick={() => setOpen(true)}>New project</Button> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          value={q}
          onChange={(event) => {
            const next = new URLSearchParams(params)
            if (event.target.value) next.set("q", event.target.value)
            else next.delete("q")
            setParams(next, { replace: true })
          }}
          placeholder="Search projects"
          className="w-full sm:w-64"
          aria-label="Search projects"
        />
        <select
          className={selectClass()}
          value={status}
          onChange={(event) => {
            const next = new URLSearchParams(params)
            if (event.target.value) next.set("status", event.target.value)
            else next.delete("status")
            setParams(next, { replace: true })
          }}
          aria-label="Project status"
        >
          <option value="">Any status</option>
          {PROJECT_STATUSES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              const next = new URLSearchParams(params)
              if (event.target.checked) next.set("archived", "1")
              else next.delete("archived")
              setParams(next, { replace: true })
            }}
          />
          Archived
        </label>
      </div>
      {projects.isLoading ? <PageLoading /> : null}
      {projects.isError ? <ErrorState message="Projects could not be loaded." onRetry={() => void projects.refetch()} /> : null}
      {projects.data && projects.data.length === 0 ? (
        <EmptyState
          title={archived ? "No archived projects" : "No projects yet"}
          body={user?.role === "admin" ? "Create the first project, or load a sample order-entry workspace to explore the views." : "An admin will add you to a project when there is work for you."}
          action={
            user?.role === "admin" ? (
              <div className="flex gap-2">
                <Button onClick={() => setOpen(true)}>New project</Button>
                <Button variant="outline" onClick={() => sample.mutate()} disabled={sample.isPending}>Load sample</Button>
              </div>
            ) : undefined
          }
        />
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(projects.data ?? []).map((project) => (
          <Link key={project.id} to={`/projects/${project.id}`} className="rounded-xl border bg-card p-4 hover:border-foreground/20">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-medium">{project.name}</h2>
              <span className="text-xs text-muted-foreground">{labelOf(PRIORITIES, project.priority)}</span>
            </div>
            <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{project.description || "No description yet."}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-harbor" style={{ width: `${project.progress}%` }} />
            </div>
            <p className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full", dotOf(PROJECT_STATUSES, project.status))} />
                {labelOf(PROJECT_STATUSES, project.status)}
              </span>
              <span>{project.members.length} people</span>
            </p>
          </Link>
        ))}
      </div>
      <ProjectForm
        open={open}
        people={(team.data ?? []).map((member) => member.user)}
        currentUserId={user?.id ?? ""}
        busy={create.isPending}
        onOpenChange={setOpen}
        onSave={async (draft) => {
          try {
            await create.mutateAsync(draft)
          } catch {
            /* toasted */
          }
        }}
      />
    </div>
  )
}

export function MyTasksPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState({ ...emptyFilters, assignee: "all" })
  const [taskId, setTaskId] = useState<string | null>(null)
  const tasks = useQuery({
    queryKey: ["tasks", "mine"],
    queryFn: () => api<Task[]>("/api/tasks?assignee=me"),
  })
  const team = useQuery({ queryKey: ["team"], queryFn: () => api<TeamMember[]>("/api/team") })
  const members = useMemo(() => (team.data ?? []).map((member) => member.user), [team.data])
  const filtered = useMemo(() => filterTasks(tasks.data ?? [], filters), [tasks.data, filters])
  const openTask = (tasks.data ?? []).find((task) => task.id === taskId) ?? null
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: TaskPatch }) => api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update the task."),
  })

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everything currently assigned to {user?.name}.</p>
      </div>
      <TaskFilters filters={filters} members={members} onChange={setFilters} showStatus />
      {tasks.isLoading ? <PageLoading /> : null}
      {tasks.isError ? <ErrorState message="Your tasks could not be loaded." onRetry={() => void tasks.refetch()} /> : null}
      {tasks.data && filtered.length === 0 ? (
        <EmptyState title="No tasks assigned to you" body="When someone assigns you work, it will land here. You can still open a project and pick something up." />
      ) : null}
      {filtered.length > 0 ? (
        <ListView tasks={filtered} members={members} showProject onOpen={setTaskId} onPatch={(id, body) => patch.mutate({ id, body })} />
      ) : null}
      <TaskDrawer task={openTask} onClose={() => setTaskId(null)} />
    </div>
  )
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const notices = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: Notice[]; unread: number }>("/api/notifications"),
  })
  const read = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  })
  const readAll = useMutation({
    mutationFn: () => api("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  })

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Assignments, comments, and deadlines. Nothing else.</p>
        </div>
        {(notices.data?.unread ?? 0) > 0 ? (
          <Button variant="outline" size="sm" onClick={() => readAll.mutate()}>Mark all read</Button>
        ) : null}
      </div>
      {notices.isLoading ? <PageLoading /> : null}
      {notices.data && notices.data.items.length === 0 ? (
        <EmptyState title="You are caught up" body="Harbor will let you know when work is assigned, commented on, or coming due." />
      ) : null}
      <div className="grid gap-2">
        {(notices.data?.items ?? []).map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn("rounded-xl border bg-card px-3 py-3 text-left", !item.read && "border-harbor/40")}
            onClick={() => {
              if (!item.read) read.mutate(item.id)
              if (item.link) navigate(item.link)
            }}
          >
            <div className="flex items-center gap-2">
              {!item.read ? <span className="size-1.5 rounded-full bg-harbor" /> : null}
              <p className="text-sm font-medium">{item.title}</p>
            </div>
            {item.body ? <p className="mt-1 text-sm text-muted-foreground">{item.body}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">{formatWhen(item.created_at)}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
