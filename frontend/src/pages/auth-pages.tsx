import { useEffect, useState, type FormEvent } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, Mark } from "@/components/ui-bits"
import { ApiError, api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh md:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      <aside className="hidden flex-col justify-between border-r bg-card px-12 py-10 md:flex">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="text-lg font-semibold tracking-tight">Harbor</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold tracking-tight text-balance">The work, the people, and what is due.</p>
          <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
            <li>See every project’s status without opening a spreadsheet.</li>
            <li>Move tasks across the board, the list, the table, or the calendar.</li>
            <li>Know who owns the next step, and what is already late.</li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">Internal workspace</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 md:hidden">
            <Mark />
            <span className="font-semibold">Harbor</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  )
}

function useError() {
  const [error, setError] = useState("")
  return {
    error,
    run: async (action: () => Promise<void>) => {
      setError("")
      try {
        await action()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Something went wrong.")
      }
    },
  }
}

export function LoginPage() {
  const { user, loading, needsSetup, login } = useAuth()
  const navigate = useNavigate()
  const { error, run } = useError()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)

  if (!loading && needsSetup) return <Navigate to="/setup" replace />
  if (!loading && user) return <Navigate to="/" replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    void run(async () => {
      await login(email, password)
      navigate("/")
    }).finally(() => setBusy(false))
  }

  return (
    <AuthFrame title="Sign in" subtitle="Use the email and password for your Harbor account.">
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy || loading}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <Link to="/forgot" className="text-center text-sm text-muted-foreground hover:text-foreground">
          Forgot password
        </Link>
      </form>
    </AuthFrame>
  )
}

export function SetupPage() {
  const { user, loading, needsSetup, refresh } = useAuth()
  const navigate = useNavigate()
  const { error, run } = useError()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)

  if (!loading && !needsSetup && user) return <Navigate to="/" replace />
  if (!loading && !needsSetup && !user) return <Navigate to="/login" replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    void run(async () => {
      await api("/api/auth/setup", { method: "POST", body: JSON.stringify({ name, email, password }) })
      await refresh()
      navigate("/")
    }).finally(() => setBusy(false))
  }

  return (
    <AuthFrame title="Create the admin account" subtitle="This workspace does not have an administrator yet. The first account can invite everyone else.">
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Your name">
          <Input required value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground">At least 8 characters, with a letter and a number.</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
    </AuthFrame>
  )
}

export function ForgotPage() {
  const { error, run } = useError()
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    void run(async () => {
      const result = await api<{ message: string }>("/api/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      })
      setMessage(result.message)
    }).finally(() => setBusy(false))
  }

  return (
    <AuthFrame title="Reset your password" subtitle="If email is set up, Harbor will send a link. Otherwise ask an admin to generate one from the team page.">
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Email">
          <Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </Button>
        <Link to="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </form>
    </AuthFrame>
  )
}

export function InvitePage() {
  const { token = "" } = useParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const { error, run } = useError()
  const [preview, setPreview] = useState<{ email: string; name: string | null; expired: boolean; accepted: boolean } | null>(null)
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ email: string; name: string | null; expired: boolean; accepted: boolean }>(`/api/auth/invite/${token}`)
      .then((data) => {
        setPreview(data)
        if (data.name) setName(data.name)
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : "This invitation is not valid."))
  }, [token])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    void run(async () => {
      await api("/api/auth/accept", { method: "POST", body: JSON.stringify({ token, name, password }) })
      await refresh()
      toast.success("Welcome to Harbor")
      navigate("/")
    }).finally(() => setBusy(false))
  }

  return (
    <AuthFrame title="Join Harbor" subtitle={preview ? `You were invited as ${preview.email}.` : "Checking the invitation…"}>
      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {preview?.expired ? <p className="text-sm text-destructive">This invitation has expired. Ask an admin for a new one.</p> : null}
      {preview?.accepted ? <p className="text-sm">This invitation was already used. Sign in instead.</p> : null}
      {preview && !preview.expired && !preview.accepted ? (
        <form className="grid gap-4" onSubmit={submit}>
          <Field label="Your name">
            <Input required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Creating account…" : "Set password and continue"}
          </Button>
        </form>
      ) : null}
      <Link to="/login" className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground">
        Back to sign in
      </Link>
    </AuthFrame>
  )
}

export function ResetPage() {
  const { token = "" } = useParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const { error, run } = useError()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password !== confirm) {
      toast.error("Those passwords do not match.")
      return
    }
    setBusy(true)
    void run(async () => {
      await api("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) })
      await refresh()
      toast.success("Password updated")
      navigate("/")
    }).finally(() => setBusy(false))
  }

  return (
    <AuthFrame title="Choose a new password" subtitle="This link works once. After you save, you will be signed in.">
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="New password">
          <Input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field label="Confirm password">
          <Input type="password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Update password"}
        </Button>
      </form>
    </AuthFrame>
  )
}
