import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, selectClass } from "@/components/ui-bits"
import { PRIORITIES, SEVERITIES, TASK_STATUSES, TASK_TYPES } from "@/lib/labels"
import type { TaskStatus, TaskType, UserBrief } from "@/lib/types"

export type TaskDraft = {
  title: string
  description: string
  task_type: TaskType
  status: TaskStatus
  priority: string
  assignee_id: string
  due_date: string
  estimate_hours: string
  tags: string
  severity: string
  steps_to_reproduce: string
  expected_result: string
  actual_result: string
}

const blank = (status: TaskStatus = "todo"): TaskDraft => ({
  title: "",
  description: "",
  task_type: "task",
  status,
  priority: "medium",
  assignee_id: "",
  due_date: "",
  estimate_hours: "",
  tags: "",
  severity: "major",
  steps_to_reproduce: "",
  expected_result: "",
  actual_result: "",
})

export function TaskDialog({
  open,
  status,
  members,
  busy,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  status?: TaskStatus
  members: UserBrief[]
  busy?: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (draft: TaskDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState<TaskDraft>(blank(status))
  useEffect(() => {
    if (open) setDraft(blank(status))
  }, [open, status])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onCreate(draft)
  }
  const set = (patch: Partial<TaskDraft>) => setDraft((current) => ({ ...current, ...patch }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg!">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form id="new-task" className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1" onSubmit={submit}>
          <Field label="Title">
            <Input required value={draft.title} onChange={(event) => set({ title: event.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea value={draft.description} onChange={(event) => set({ description: event.target.value })} rows={3} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select className={selectClass()} value={draft.task_type} onChange={(event) => set({ task_type: event.target.value as TaskType })}>
                {TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={selectClass()} value={draft.status} onChange={(event) => set({ status: event.target.value as TaskStatus })}>
                {TASK_STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={selectClass()} value={draft.priority} onChange={(event) => set({ priority: event.target.value })}>
                {PRIORITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Assignee">
              <select className={selectClass()} value={draft.assignee_id} onChange={(event) => set({ assignee_id: event.target.value })}>
                <option value="">Unassigned</option>
                {members.filter((person) => person.status === "active").map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Due">
              <Input type="date" value={draft.due_date} onChange={(event) => set({ due_date: event.target.value })} />
            </Field>
            <Field label="Estimate (hours)">
              <Input type="number" min={0} step="0.5" value={draft.estimate_hours} onChange={(event) => set({ estimate_hours: event.target.value })} />
            </Field>
          </div>
          <Field label="Tags">
            <Input value={draft.tags} onChange={(event) => set({ tags: event.target.value })} placeholder="Comma separated" />
          </Field>
          {draft.task_type === "bug" ? (
            <div className="grid gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-3">
              <Field label="Severity">
                <select className={selectClass()} value={draft.severity} onChange={(event) => set({ severity: event.target.value })}>
                  {SEVERITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Steps to reproduce">
                <Textarea value={draft.steps_to_reproduce} onChange={(event) => set({ steps_to_reproduce: event.target.value })} rows={2} />
              </Field>
              <Field label="Expected result">
                <Textarea value={draft.expected_result} onChange={(event) => set({ expected_result: event.target.value })} rows={2} />
              </Field>
              <Field label="Actual result">
                <Textarea value={draft.actual_result} onChange={(event) => set({ actual_result: event.target.value })} rows={2} />
              </Field>
            </div>
          ) : null}
        </form>
        <DialogFooter>
          <Button type="submit" form="new-task" disabled={busy}>{busy ? "Creating…" : "Create task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
