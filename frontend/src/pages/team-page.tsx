import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { EmptyState, ErrorState, Field, PageLoading, Person, selectClass } from "@/components/ui-bits"
import { ApiError, api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { LinkResult, TeamMember } from "@/lib/types"
import { cn } from "@/lib/utils"

export function TeamPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.get("invite") === "1")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState("member")
  const [link, setLink] = useState<string | null>(null)
  const team = useQuery({ queryKey: ["team"], queryFn: () => api<TeamMember[]>("/api/team") })

  useEffect(() => {
    if (params.get("invite") === "1") setOpen(true)
  }, [params])

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["team"] })
  const invite = useMutation({
    mutationFn: () => api<LinkResult>("/api/team/invite", { method: "POST", body: JSON.stringify({ email, name: name || null, role }) }),
    onSuccess: (result) => {
      setLink(result.url)
      toast.success(result.message)
      setEmail("")
      setName("")
      refresh()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not send the invitation."),
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: string; status?: string } }) =>
      api(`/api/team/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: refresh,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update that person."),
  })
  const reset = useMutation({
    mutationFn: (id: string) => api<LinkResult>(`/api/team/${id}/reset-link`, { method: "POST" }),
    onSuccess: async (result) => {
      if (result.url) {
        await navigator.clipboard.writeText(result.url)
        toast.success("Reset link copied")
      } else toast.success(result.message)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create a reset link."),
  })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">Who is here, what they are carrying, and whether they can sign in.</p>
        </div>
        {user?.role === "admin" ? (
          <Button
            onClick={() => {
              setLink(null)
              setOpen(true)
            }}
          >
            Invite someone
          </Button>
        ) : null}
      </div>
      {team.isLoading ? <PageLoading /> : null}
      {team.isError ? <ErrorState message="The team could not be loaded." onRetry={() => void team.refetch()} /> : null}
      {team.data && team.data.length === 0 ? <EmptyState title="No one else is here yet" body="Invite the people who will work in this workspace." /> : null}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Projects</th>
              <th className="px-3 py-2 font-medium">Open</th>
              <th className="px-3 py-2 font-medium">Done</th>
              <th className="px-3 py-2 font-medium">Status</th>
              {user?.role === "admin" ? <th className="px-3 py-2 font-medium">Access</th> : null}
            </tr>
          </thead>
          <tbody>
            {(team.data ?? []).map((member) => (
              <tr key={member.user.id} className={cn("border-b last:border-b-0", member.user.status !== "active" && "opacity-60")}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Person id={member.user.id} name={member.user.name} />
                    <div>
                      <p className="font-medium">{member.user.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {member.user.title ? `${member.user.title} · ` : ""}
                        {member.user.email}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{member.projects.map((project) => project.name).join(", ") || "—"}</td>
                <td className="px-3 py-2 tabular-nums">{member.open_tasks}</td>
                <td className="px-3 py-2 tabular-nums">{member.done_tasks}</td>
                <td className="px-3 py-2 capitalize">{member.user.status}</td>
                {user?.role === "admin" ? (
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className={selectClass("h-7")}
                        value={member.user.role}
                        onChange={(event) => update.mutate({ id: member.user.id, body: { role: event.target.value } })}
                        aria-label={`Role for ${member.user.name}`}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          update.mutate({
                            id: member.user.id,
                            body: { status: member.user.status === "active" ? "deactivated" : "active" },
                          })
                        }
                      >
                        {member.user.status === "active" ? "Deactivate" : "Restore"}
                      </Button>
                      {member.user.status === "active" ? (
                        <Button variant="ghost" size="sm" onClick={() => reset.mutate(member.user.id)}>
                          Reset link
                        </Button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next && params.get("invite")) {
            const copy = new URLSearchParams(params)
            copy.delete("invite")
            setParams(copy, { replace: true })
          }
        }}
      >
        <DialogContent className="sm:max-w-md!">
          <DialogHeader>
            <DialogTitle>Invite someone</DialogTitle>
          </DialogHeader>
          <form
            id="invite-form"
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              invite.mutate()
            }}
          >
            <Field label="Email">
              <Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            <Field label="Name (optional)">
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Role">
              <select className={selectClass()} value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="member">Team member</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            {link ? (
              <div className="grid gap-1">
                <p className="text-sm text-muted-foreground">Email is not configured. Share this activation link.</p>
                <Input readOnly value={link} onFocus={(event) => event.target.select()} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(link)
                    toast.success("Link copied")
                  }}
                >
                  Copy link
                </Button>
              </div>
            ) : null}
          </form>
          <DialogFooter>
            <Button type="submit" form="invite-form" disabled={invite.isPending}>
              {invite.isPending ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function SettingsPage() {
  const { user, refresh } = useAuth()
  const [name, setName] = useState(user?.name ?? "")
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user) setName(user.name)
  }, [user])

  return (
    <div className="mx-auto grid max-w-lg gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your name and password. Role changes are made by an admin.</p>
      </div>
      <form
        className="grid gap-3 rounded-xl border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          api("/api/auth/me", { method: "PATCH", body: JSON.stringify({ name }) })
            .then(async () => {
              await refresh()
              toast.success("Profile saved")
            })
            .catch((err: unknown) => toast.error(err instanceof ApiError ? err.message : "Could not save."))
            .finally(() => setBusy(false))
        }}
      >
        <Field label="Name">
          <Input required value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Email">
          <Input value={user?.email ?? ""} disabled />
        </Field>
        <p className="text-xs text-muted-foreground">
          {user?.title ? `${user.title} · ` : ""}
          <span className="capitalize">{user?.role}</span>
        </p>
        <Button type="submit" className="justify-self-start" disabled={busy}>Save profile</Button>
      </form>
      <form
        className="grid gap-3 rounded-xl border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          api("/api/auth/change-password", {
            method: "POST",
            body: JSON.stringify({ current_password: current, new_password: next }),
          })
            .then(() => {
              setCurrent("")
              setNext("")
              toast.success("Password updated")
            })
            .catch((err: unknown) => toast.error(err instanceof ApiError ? err.message : "Could not update the password."))
            .finally(() => setBusy(false))
        }}
      >
        <h2 className="text-sm font-medium">Change password</h2>
        <Field label="Current password">
          <Input type="password" required value={current} onChange={(event) => setCurrent(event.target.value)} />
        </Field>
        <Field label="New password">
          <Input type="password" required minLength={8} value={next} onChange={(event) => setNext(event.target.value)} />
        </Field>
        <Button type="submit" variant="outline" className="justify-self-start" disabled={busy}>Update password</Button>
      </form>
    </div>
  )
}
