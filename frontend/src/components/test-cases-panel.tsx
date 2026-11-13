import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, Field, Person, selectClass } from "@/components/ui-bits"
import { ApiError, api, download } from "@/lib/api"
import { PRIORITIES } from "@/lib/labels"
import type { Project, TestCase, TestCaseStatus, TestCaseType, UserBrief } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUSES: { id: TestCaseStatus; label: string; dot: string }[] = [
  { id: "not_run", label: "Not run", dot: "bg-slate-400" },
  { id: "pass", label: "Pass", dot: "bg-emerald-500" },
  { id: "fail", label: "Fail", dot: "bg-rose-500" },
  { id: "blocked", label: "Blocked", dot: "bg-amber-500" },
]
const TYPES: { id: TestCaseType; label: string }[] = [
  { id: "functional", label: "Functional" },
  { id: "regression", label: "Regression" },
  { id: "smoke", label: "Smoke" },
  { id: "integration", label: "Integration" },
  { id: "ui", label: "UI" },
]

type Draft = {
  title: string
  module: string
  priority: string
  case_type: TestCaseType
  preconditions: string
  steps: string
  expected_result: string
  actual_result: string
  status: TestCaseStatus
  assignee_id: string
  comments: string
}

const emptyDraft = (): Draft => ({
  title: "",
  module: "",
  priority: "medium",
  case_type: "functional",
  preconditions: "",
  steps: "",
  expected_result: "",
  actual_result: "",
  status: "not_run",
  assignee_id: "",
  comments: "",
})

function fromCase(row: TestCase): Draft {
  return {
    title: row.title,
    module: row.module,
    priority: row.priority,
    case_type: row.case_type,
    preconditions: row.preconditions,
    steps: row.steps,
    expected_result: row.expected_result,
    actual_result: row.actual_result,
    status: row.status,
    assignee_id: row.assignee?.id ?? "",
    comments: row.comments,
  }
}

export function TestCasesPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const cases = useQuery({
    queryKey: ["test-cases", projectId],
    queryFn: () => api<TestCase[]>(`/api/projects/${projectId}/test-cases`),
  })
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/api/projects/${projectId}`),
  })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<TestCase | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const members = project.data?.members ?? []

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["test-cases", projectId] })
  const fail = (err: unknown) => toast.error(err instanceof ApiError ? err.message : "Could not save that test case.")

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...draft,
        assignee_id: draft.assignee_id || null,
        clear_assignee: !draft.assignee_id,
      }
      if (editing) return api(`/api/test-cases/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) })
      return api(`/api/projects/${projectId}/test-cases`, { method: "POST", body: JSON.stringify(body) })
    },
    onSuccess: () => {
      setOpen(false)
      setEditing(null)
      refresh()
      toast.success(editing ? "Test case updated" : "Test case added")
    },
    onError: fail,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/test-cases/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh()
      toast.success("Test case removed")
    },
    onError: fail,
  })

  const importFile = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append("file", file)
      return api<{ created: number; updated: number }>(`/api/projects/${projectId}/test-cases/import`, { method: "POST", body })
    },
    onSuccess: (result) => {
      refresh()
      toast.success(`Imported ${result.created} new and updated ${result.updated}`)
    },
    onError: fail,
  })

  const startCreate = () => {
    setEditing(null)
    setDraft(emptyDraft())
    setOpen(true)
  }
  const startEdit = (row: TestCase) => {
    setEditing(row)
    setDraft(fromCase(row))
    setOpen(true)
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Test cases</h2>
          <p className="mt-1 text-sm text-muted-foreground">A blank sheet for this project. Import or export the standard CSV template.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              download(`/api/projects/${projectId}/test-cases/export`, "test-cases.csv").catch(fail)
            }}
          >
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importFile.isPending}>
            Import CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) importFile.mutate(file)
            }}
          />
          <Button onClick={startCreate}>Add test case</Button>
        </div>
      </div>
      {cases.data && cases.data.length === 0 ? (
        <EmptyState
          title="No test cases yet"
          body="The sheet starts empty. Add a case, or export the template, fill it in, and import it."
        />
      ) : null}
      {cases.data && cases.data.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Module</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Assigned</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {cases.data.map((row) => {
                const status = STATUSES.find((item) => item.id === row.status)
                return (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.code}</td>
                    <td className="px-3 py-2">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => startEdit(row)}>
                        {row.title}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.module || "—"}</td>
                    <td className="px-3 py-2 capitalize">{row.priority}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("size-1.5 rounded-full", status?.dot)} />
                        {status?.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.assignee ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Person id={row.assignee.id} name={row.assignee.name} className="size-5" />
                          {row.assignee.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(row.id)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <CaseDialog
        open={open}
        title={editing ? editing.code : "New test case"}
        draft={draft}
        members={members}
        busy={save.isPending}
        onChange={setDraft}
        onOpenChange={setOpen}
        onSave={() => save.mutate()}
      />
    </div>
  )
}

function CaseDialog({
  open,
  title,
  draft,
  members,
  busy,
  onChange,
  onOpenChange,
  onSave,
}: {
  open: boolean
  title: string
  draft: Draft
  members: UserBrief[]
  busy: boolean
  onChange: (next: Draft) => void
  onOpenChange: (open: boolean) => void
  onSave: () => void
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl!">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          id="test-case-form"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            onSave()
          }}
        >
          <Field label="Title">
            <Input required value={draft.title} onChange={(event) => set({ title: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Module">
              <Input value={draft.module} onChange={(event) => set({ module: event.target.value })} />
            </Field>
            <Field label="Assigned to">
              <select className={selectClass()} value={draft.assignee_id} onChange={(event) => set({ assignee_id: event.target.value })}>
                <option value="">Unassigned</option>
                {members.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select className={selectClass()} value={draft.priority} onChange={(event) => set({ priority: event.target.value })}>
                {PRIORITIES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select className={selectClass()} value={draft.case_type} onChange={(event) => set({ case_type: event.target.value as TestCaseType })}>
                {TYPES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select className={selectClass()} value={draft.status} onChange={(event) => set({ status: event.target.value as TestCaseStatus })}>
                {STATUSES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Preconditions">
            <Textarea value={draft.preconditions} onChange={(event) => set({ preconditions: event.target.value })} />
          </Field>
          <Field label="Steps">
            <Textarea value={draft.steps} onChange={(event) => set({ steps: event.target.value })} />
          </Field>
          <Field label="Expected result">
            <Textarea value={draft.expected_result} onChange={(event) => set({ expected_result: event.target.value })} />
          </Field>
          <Field label="Actual result">
            <Textarea value={draft.actual_result} onChange={(event) => set({ actual_result: event.target.value })} />
          </Field>
          <Field label="Comments">
            <Textarea value={draft.comments} onChange={(event) => set({ comments: event.target.value })} />
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="test-case-form" disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
