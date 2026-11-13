import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Person } from "@/components/ui-bits"
import { ApiError, api } from "@/lib/api"
import { formatWhen } from "@/lib/labels"
import { useAuth } from "@/lib/auth"
import type { Activity, Checklist, Note } from "@/lib/types"

export function NotesPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const notes = useQuery({ queryKey: ["notes", projectId], queryFn: () => api<Note[]>(`/api/projects/${projectId}/notes`) })
  const lists = useQuery({ queryKey: ["checklists", projectId], queryFn: () => api<Checklist[]>(`/api/projects/${projectId}/checklists`) })
  const activity = useQuery({ queryKey: ["activity", projectId], queryFn: () => api<Activity[]>(`/api/activity?project_id=${projectId}`) })
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [listTitle, setListTitle] = useState("")
  const [itemTitle, setItemTitle] = useState<Record<string, string>>({})

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["notes", projectId] })
    void queryClient.invalidateQueries({ queryKey: ["checklists", projectId] })
    void queryClient.invalidateQueries({ queryKey: ["activity", projectId] })
    void queryClient.invalidateQueries({ queryKey: ["notifications"] })
  }
  const fail = (err: unknown) => toast.error(err instanceof ApiError ? err.message : "Could not save that.")

  const addNote = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/notes`, { method: "POST", body: JSON.stringify({ title, body }) }),
    onSuccess: () => {
      setTitle("")
      setBody("")
      refresh()
    },
    onError: fail,
  })
  const removeNote = useMutation({
    mutationFn: (id: string) => api(`/api/notes/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: fail,
  })
  const addList = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/checklists`, { method: "POST", body: JSON.stringify({ title: listTitle }) }),
    onSuccess: () => {
      setListTitle("")
      refresh()
    },
    onError: fail,
  })
  const addItem = useMutation({
    mutationFn: ({ id, title: item }: { id: string; title: string }) =>
      api(`/api/checklists/${id}/items`, { method: "POST", body: JSON.stringify({ title: item }) }),
    onSuccess: (_data, vars) => {
      setItemTitle((current) => ({ ...current, [vars.id]: "" }))
      refresh()
    },
    onError: fail,
  })
  const toggle = useMutation({
    mutationFn: ({ id, is_done }: { id: string; is_done: boolean }) =>
      api(`/api/checklist-items/${id}`, { method: "PATCH", body: JSON.stringify({ is_done }) }),
    onSuccess: refresh,
    onError: fail,
  })
  const removeItem = useMutation({
    mutationFn: (id: string) => api(`/api/checklist-items/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: fail,
  })
  const removeList = useMutation({
    mutationFn: (id: string) => api(`/api/checklists/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: fail,
  })

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">Notes</h2>
        <form
          className="grid gap-2 rounded-xl border bg-card p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (body.trim()) addNote.mutate()
          }}
        >
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title (optional)" />
          <Textarea required value={body} onChange={(event) => setBody(event.target.value)} placeholder="What should the team remember?" rows={3} />
          <Button type="submit" className="justify-self-start" disabled={addNote.isPending || !body.trim()}>
            Add note
          </Button>
        </form>
        {(notes.data ?? []).map((note) => (
          <article key={note.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Person id={note.author.id} name={note.author.name} />
                <span className="font-medium text-foreground">{note.author.name}</span>
                <span>{formatWhen(note.created_at)}</span>
              </div>
              {user && (user.id === note.author.id || user.role === "admin") ? (
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => removeNote.mutate(note.id)}>
                  Delete
                </button>
              ) : null}
            </div>
            {note.title ? <h3 className="mt-2 text-sm font-medium">{note.title}</h3> : null}
            <p className="mt-1 text-sm whitespace-pre-wrap">{note.body}</p>
          </article>
        ))}
        {(notes.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No notes yet.</p> : null}
        <h2 className="mt-4 text-sm font-medium">Activity</h2>
        <ol className="grid gap-2">
          {(activity.data ?? []).map((item) => (
            <li key={item.id} className="text-sm">
              <span>{item.summary}</span>
              <span className="ml-2 text-xs text-muted-foreground">{formatWhen(item.created_at)}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="grid content-start gap-3">
        <h2 className="text-sm font-medium">Checklists</h2>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (listTitle.trim()) addList.mutate()
          }}
        >
          <Input value={listTitle} onChange={(event) => setListTitle(event.target.value)} placeholder="Deployment checklist" />
          <Button type="submit" variant="outline" disabled={!listTitle.trim()}>Add</Button>
        </form>
        {(lists.data ?? []).map((list) => (
          <div key={list.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{list.title}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">{list.progress}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-harbor" style={{ width: `${list.progress}%` }} />
            </div>
            <ul className="mt-3 grid gap-1.5">
              {list.items.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={item.is_done}
                    onChange={(event) => toggle.mutate({ id: item.id, is_done: event.target.checked })}
                  />
                  <span className={item.is_done ? "text-muted-foreground line-through" : ""}>
                    {item.title}
                    {item.completer ? <span className="ml-1 text-xs text-muted-foreground">· {item.completer.name}</span> : null}
                  </span>
                  <button type="button" className="ml-auto text-xs text-muted-foreground" onClick={() => removeItem.mutate(item.id)} aria-label={`Remove ${item.title}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                const next = (itemTitle[list.id] ?? "").trim()
                if (next) addItem.mutate({ id: list.id, title: next })
              }}
            >
              <Input
                value={itemTitle[list.id] ?? ""}
                onChange={(event) => setItemTitle((current) => ({ ...current, [list.id]: event.target.value }))}
                placeholder="Add an item"
              />
              <Button type="submit" variant="ghost" size="sm">Add</Button>
            </form>
            {user?.role === "admin" ? (
              <button type="button" className="mt-2 text-xs text-muted-foreground underline" onClick={() => removeList.mutate(list.id)}>
                Delete checklist
              </button>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  )
}
