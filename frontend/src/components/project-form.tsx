import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, selectClass } from "@/components/ui-bits"
import { PRIORITIES, PROJECT_STATUSES } from "@/lib/labels"
import type { Priority, Project, ProjectStatus, UserBrief } from "@/lib/types"

export type ProjectDraft = {
  name: string
  description: string
  owner_id: string
  status: ProjectStatus
  priority: Priority
  start_date: string
  target_date: string
  tags: string
  member_ids: string[]
}

export function ProjectForm({
  open,
  project,
  people,
  currentUserId,
  busy,
  onOpenChange,
  onSave,
}: {
  open: boolean
  project?: Project | null
  people: UserBrief[]
  currentUserId: string
  busy?: boolean
  onOpenChange: (open: boolean) => void
  onSave: (draft: ProjectDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState<ProjectDraft>(empty(currentUserId))
  useEffect(() => {
    if (!open) return
    if (project) {
      setDraft({
        name: project.name,
        description: project.description,
        owner_id: project.owner.id,
        status: project.status,
        priority: project.priority,
        start_date: project.start_date ?? "",
        target_date: project.target_date ?? "",
        tags: project.tags.join(", "),
        member_ids: project.members.map((person) => person.id),
      })
    } else {
      setDraft(empty(currentUserId))
    }
  }, [open, project, currentUserId])

  const set = (patch: Partial<ProjectDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const active = people.filter((person) => person.status === "active")

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onSave(draft)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg!">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
        </DialogHeader>
        <form id="project-form" className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1" onSubmit={submit}>
          <Field label="Name">
            <Input required value={draft.name} onChange={(event) => set({ name: event.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea value={draft.description} onChange={(event) => set({ description: event.target.value })} rows={3} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status">
              <select className={selectClass()} value={draft.status} onChange={(event) => set({ status: event.target.value as ProjectStatus })}>
                {PROJECT_STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={selectClass()} value={draft.priority} onChange={(event) => set({ priority: event.target.value as Priority })}>
                {PRIORITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Owner">
              <select className={selectClass()} value={draft.owner_id} onChange={(event) => set({ owner_id: event.target.value })}>
                {active.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </Field>
            <Field label="Tags">
              <Input value={draft.tags} onChange={(event) => set({ tags: event.target.value })} placeholder="Comma separated" />
            </Field>
            <Field label="Start">
              <Input type="date" value={draft.start_date} onChange={(event) => set({ start_date: event.target.value })} />
            </Field>
            <Field label="Target">
              <Input type="date" value={draft.target_date} onChange={(event) => set({ target_date: event.target.value })} />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Team</legend>
            <div className="grid max-h-40 gap-1 overflow-y-auto">
              {active.map((person) => {
                const checked = draft.member_ids.includes(person.id) || person.id === draft.owner_id
                return (
                  <label key={person.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={person.id === draft.owner_id}
                      onChange={(event) => {
                        const ids = new Set(draft.member_ids)
                        if (event.target.checked) ids.add(person.id)
                        else ids.delete(person.id)
                        set({ member_ids: [...ids] })
                      }}
                    />
                    {person.name}
                    <span className="text-muted-foreground">{person.email}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        </form>
        <DialogFooter>
          <Button type="submit" form="project-form" disabled={busy}>{busy ? "Saving…" : project ? "Save project" : "Create project"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function empty(ownerId: string): ProjectDraft {
  return {
    name: "",
    description: "",
    owner_id: ownerId,
    status: "planning",
    priority: "medium",
    start_date: "",
    target_date: "",
    tags: "",
    member_ids: ownerId ? [ownerId] : [],
  }
}
