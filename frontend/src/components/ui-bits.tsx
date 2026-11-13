import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { avatarClass, initials } from "@/lib/labels"

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 text-foreground", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M8 22h16M11 22V13.5h4V22M17.5 22V10h4V22"
        fill="none"
        stroke="var(--background)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Person({ name, id, className }: { name: string; id?: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        avatarClass(id || name),
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function PageLoading() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-28 animate-pulse rounded-xl bg-muted" />
      <div className="h-28 animate-pulse rounded-xl bg-muted" />
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border bg-card px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <button type="button" className="mt-3 text-sm font-medium underline" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  )
}

export function selectClass(className?: string) {
  return cn(
    "h-8 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
    className,
  )
}
