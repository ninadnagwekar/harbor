import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, Person, selectClass } from "@/components/ui-bits"
import { ApiError, api } from "@/lib/api"
import { PRIORITIES, SEVERITIES, TASK_STATUSES, TASK_TYPES, fileSize, formatWhen, labelOf } from "@/lib/labels"
import type { Attachment, Comment, Project, Task, TaskPatch } from "@/lib/types"

export function TaskDrawer({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const project = useQuery({
    queryKey: ["project", task?.project_id],
    enabled: Boolean(task),
    queryFn: () => api<Project>(`/api/projects/${task?.project_id}`),
  })
  const comments = useQuery({
    queryKey: ["comments", task?.id],
    enabled: Boolean(task),
    queryFn: () => api<Comment[]>(`/api/tasks/${task?.id}/comments`),
  })
  const attachments = useQuery({
    queryKey: ["attachments", task?.id],
    enabled: Boolean(task),
    queryFn: () => api<Attachment[]>(`/api/tasks/${task?.id}/attachments`),
  })
  const [draft, setDraft] = useState<Task | null>(task)
  const [comment, setComment] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const members = project.data?.members ?? []

  useEffect(() => {
    setDraft(task)
    setConfirmDelete(false)
    setComment("")
  }, [task])

  const save = useMutation({
    mutationFn: (patch: TaskPatch) => api<Task>(`/api/tasks/${task?.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (updated) => {
      setDraft(updated)
      void queryClient.invalidateQueries({ queryKey: ["tasks"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      void queryClient.invalidateQueries({ queryKey: ["notifications"] })
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save."),
  })

  const patch = (next: TaskPatch) => {
    if (!draft) return
    const member = members.find((person) => person.id === next.assignee_id)
    setDraft({
      ...draft,
      ...(next as Partial<Task>),
      assignee: "assignee_id" in next ? member ?? null : draft.assignee,
      overdue: next.status === "done" ? false : draft.overdue,
    })
    save.mutate(next)
  }

  const remove = useMutation({
    mutationFn: () => api(`/api/tasks/${task?.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Task deleted")
      void queryClient.invalidateQueries({ queryKey: ["tasks"] })
      onClose()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not delete."),
  })

  const addComment = useMutation({
    mutationFn: () => api<Comment>(`/api/tasks/${task?.id}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) }),
    onSuccess: () => {
      setComment("")
      void queryClient.invalidateQueries({ queryKey: ["comments", task?.id] })
      void queryClient.invalidateQueries({ queryKey: ["notifications"] })
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not comment."),
  })

  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append("file", file)
      return api<Attachment>(`/api/tasks/${task?.id}/attachments`, { method: "POST", body })
    },
    onSuccess: () => {
      toast.success("File attached")
      void queryClient.invalidateQueries({ queryKey: ["attachments", task?.id] })
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not attach the file."),
  })

  return (
    <Sheet open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl!">
        {draft ? (
          <div className="grid gap-5 pb-8">
            <SheetHeader className="pr-8">
              <p className="text-xs text-muted-foreground">{draft.project_name}</p>
              <SheetTitle className="sr-only">Task details</SheetTitle>
              <Input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                onBlur={() => draft.title.trim() && draft.title !== task?.title && patch({ title: draft.title.trim() })}
                className="h-auto border-transparent px-0 text-lg font-semibold shadow-none focus-visible:border-input"
              />
            </SheetHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type">
                <select className={selectClass()} value={draft.task_type} onChange={(event) => patch({ task_type: event.target.value as Task["task_type"] })}>
                  {TASK_TYPES.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select className={selectClass()} value={draft.status} onChange={(event) => patch({ status: event.target.value as Task["status"] })}>
                  {TASK_STATUSES.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select className={selectClass()} value={draft.priority} onChange={(event) => patch({ priority: event.target.value as Task["priority"] })}>
                  {PRIORITIES.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Assignee">
                <select
                  className={selectClass()}
                  value={draft.assignee?.id ?? ""}
                  onChange={(event) => patch({ assignee_id: event.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {members.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Start">
                <Input type="date" value={draft.start_date ?? ""} onChange={(event) => patch({ start_date: event.target.value || null })} />
              </Field>
              <Field label="Due">
                <Input type="date" value={draft.due_date ?? ""} onChange={(event) => patch({ due_date: event.target.value || null })} />
              </Field>
              <Field label="Estimate (hours)">
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={draft.estimate_hours ?? ""}
                  onChange={(event) => setDraft({ ...draft, estimate_hours: event.target.value === "" ? null : Number(event.target.value) })}
                  onBlur={() => patch({ estimate_hours: draft.estimate_hours })}
                />
              </Field>
              <Field label="Tags">
                <Input
                  value={draft.tags.join(", ")}
                  onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })}
                  onBlur={() => patch({ tags: draft.tags })}
                  placeholder="api, frontend"
                />
              </Field>
            </div>
            <Field label="Description">
              <Textarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                onBlur={() => draft.description !== task?.description && patch({ description: draft.description })}
                rows={4}
              />
            </Field>
            {draft.task_type === "bug" ? (
              <div className="grid gap-3 rounded-xl border border-rose-100 bg-rose-50/40 p-3">
                <p className="text-xs font-semibold tracking-wide text-rose-700 uppercase">Bug details</p>
                <Field label="Severity">
                  <select className={selectClass()} value={draft.severity ?? ""} onChange={(event) => patch({ severity: (event.target.value || null) as Task["severity"] })}>
                    <option value="">Not set</option>
                    {SEVERITIES.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Steps to reproduce">
                  <Textarea value={draft.steps_to_reproduce} onChange={(event) => setDraft({ ...draft, steps_to_reproduce: event.target.value })} onBlur={() => patch({ steps_to_reproduce: draft.steps_to_reproduce })} rows={3} />
                </Field>
                <Field label="Expected result">
                  <Textarea value={draft.expected_result} onChange={(event) => setDraft({ ...draft, expected_result: event.target.value })} onBlur={() => patch({ expected_result: draft.expected_result })} rows={2} />
                </Field>
                <Field label="Actual result">
                  <Textarea value={draft.actual_result} onChange={(event) => setDraft({ ...draft, actual_result: event.target.value })} onBlur={() => patch({ actual_result: draft.actual_result })} rows={2} />
                </Field>
                <Field label="Resolution notes">
                  <Textarea value={draft.resolution_notes} onChange={(event) => setDraft({ ...draft, resolution_notes: event.target.value })} onBlur={() => patch({ resolution_notes: draft.resolution_notes })} rows={2} />
                </Field>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Created by {draft.creator.name} · {formatWhen(draft.created_at)}
              {draft.updated_at !== draft.created_at ? ` · Updated ${formatWhen(draft.updated_at)}` : ""}
              {save.isPending ? " · Saving…" : ""}
            </p>
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">Attachments</h3>
              {(attachments.data ?? []).map((file) => (
                <div key={file.id} className="flex items-center justify-between gap-2 text-sm">
                  <a className="truncate underline" href={`/api/attachments/${file.id}`}>
                    {file.filename}
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground">{fileSize(file.size)}</span>
                </div>
              ))}
              <Input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) upload.mutate(file)
                  event.target.value = ""
                }}
              />
              <p className="text-xs text-muted-foreground">Up to 5 MB, 10 files per task.</p>
            </section>
            <section className="grid gap-3">
              <h3 className="text-sm font-medium">Comments</h3>
              {(comments.data ?? []).map((item) => (
                <div key={item.id} className="rounded-xl border bg-card px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Person id={item.author.id} name={item.author.name} />
                    <span className="font-medium text-foreground">{item.author.name}</span>
                    <span>{formatWhen(item.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-sm whitespace-pre-wrap">{item.body}</p>
                </div>
              ))}
              {(comments.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add an update" rows={3} />
              <Button
                className="justify-self-start"
                disabled={!comment.trim() || addComment.isPending}
                onClick={() => addComment.mutate()}
              >
                Comment
              </Button>
            </section>
            <div>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm">Delete this task?</span>
                  <Button variant="destructive" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setConfirmDelete(true)}>
                  Delete task
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Status: {labelOf(TASK_STATUSES, draft.status)}</p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

