import { format } from "date-fns"

export const TASK_STATUSES = [
  { id: "backlog", label: "Backlog", dot: "bg-slate-400" },
  { id: "todo", label: "To do", dot: "bg-sky-500" },
  { id: "in_progress", label: "In progress", dot: "bg-amber-500" },
  { id: "in_review", label: "In review", dot: "bg-violet-500" },
  { id: "blocked", label: "Blocked", dot: "bg-rose-500" },
  { id: "done", label: "Done", dot: "bg-emerald-500" },
] as const

export const PROJECT_STATUSES = [
  { id: "not_started", label: "Not started", dot: "bg-slate-400" },
  { id: "planning", label: "Planning", dot: "bg-sky-500" },
  { id: "in_progress", label: "In progress", dot: "bg-amber-500" },
  { id: "on_hold", label: "On hold", dot: "bg-orange-500" },
  { id: "completed", label: "Completed", dot: "bg-emerald-500" },
] as const

export const PRIORITIES = [
  { id: "low", label: "Low", dot: "bg-slate-300" },
  { id: "medium", label: "Medium", dot: "bg-sky-500" },
  { id: "high", label: "High", dot: "bg-amber-500" },
  { id: "critical", label: "Critical", dot: "bg-rose-500" },
] as const

export const TASK_TYPES = [
  { id: "task", label: "Task" },
  { id: "bug", label: "Bug" },
  { id: "feature", label: "Feature" },
  { id: "improvement", label: "Improvement" },
] as const

export const SEVERITIES = [
  { id: "minor", label: "Minor" },
  { id: "major", label: "Major" },
  { id: "critical", label: "Critical" },
  { id: "blocker", label: "Blocker" },
] as const

export const TYPE_ACCENT: Record<string, string> = {
  task: "border-l-slate-300",
  bug: "border-l-rose-400",
  feature: "border-l-indigo-400",
  improvement: "border-l-teal-500",
}

export function labelOf(list: readonly { id: string; label: string }[], id: string) {
  return list.find((item) => item.id === id)?.label ?? id
}

export function dotOf(list: readonly { id: string; dot: string }[], id: string) {
  return list.find((item) => item.id === id)?.dot ?? "bg-slate-300"
}

export function parseISODate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

export function dueMeta(due: string | null, status: string) {
  if (!due) return null
  const date = parseISODate(due)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((date.getTime() - start.getTime()) / 86400000)
  const overdue = diff < 0 && status !== "done"
  let text = format(date, date.getFullYear() === now.getFullYear() ? "d MMM" : "d MMM yyyy")
  if (overdue) text = diff === -1 ? "Yesterday" : `${-diff}d overdue`
  else if (diff === 0) text = "Today"
  else if (diff === 1) text = "Tomorrow"
  return { text, overdue, soon: diff >= 0 && diff <= 2 }
}

export function formatWhen(value: string) {
  const date = new Date(value)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return format(date, "h:mm a")
  if (date.getFullYear() === now.getFullYear()) return format(date, "d MMM, h:mm a")
  return format(date, "d MMM yyyy")
}

export function formatDay(value: string | null) {
  if (!value) return "—"
  const date = parseISODate(value)
  const now = new Date()
  return format(date, date.getFullYear() === now.getFullYear() ? "d MMM" : "d MMM yyyy")
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

const AVATAR = [
  "bg-rose-200 text-rose-900",
  "bg-orange-200 text-orange-950",
  "bg-amber-200 text-amber-950",
  "bg-lime-200 text-lime-950",
  "bg-emerald-200 text-emerald-950",
  "bg-teal-200 text-teal-950",
  "bg-cyan-200 text-cyan-950",
  "bg-sky-200 text-sky-950",
  "bg-blue-200 text-blue-950",
  "bg-indigo-200 text-indigo-950",
  "bg-violet-200 text-violet-950",
  "bg-fuchsia-200 text-fuchsia-950",
  "bg-pink-200 text-pink-950",
]

export function avatarClass(seed: string) {
  let hash = 2166136261
  for (const char of seed) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return AVATAR[Math.abs(hash) % AVATAR.length] ?? AVATAR[0]
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
