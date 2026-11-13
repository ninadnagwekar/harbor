import { useEffect, useState } from "react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Bell, CheckSquare, FolderKanban, LayoutDashboard, Menu, Search, Settings, Users } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { Notice, Project, SearchResult } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Mark, Person } from "@/components/ui-bits"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/my-tasks", label: "My tasks", icon: CheckSquare, end: false },
  { to: "/projects", label: "Projects", icon: FolderKanban, end: false },
  { to: "/team", label: "Team", icon: Users, end: false },
  { to: "/notifications", label: "Notifications", icon: Bell, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
]

function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const projects = useQuery({
    queryKey: ["projects", "sidebar"],
    queryFn: () => api<Project[]>("/api/projects"),
  })
  const notices = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: Notice[]; unread: number }>("/api/notifications"),
    refetchInterval: 60_000,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Mark />
        <span className="font-semibold tracking-tight">Harbor</span>
      </div>
      <nav className="grid gap-0.5 px-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground",
                isActive && "bg-harbor-soft font-medium text-foreground",
              )
            }
          >
            <item.icon className="size-4" />
            <span className="flex-1">{item.label}</span>
            {item.to === "/notifications" && (notices.data?.unread ?? 0) > 0 ? (
              <span className="rounded-full bg-harbor px-1.5 text-[10px] font-semibold text-harbor-foreground">
                {notices.data?.unread}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6 px-3">
        <p className="px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Projects</p>
        <div className="mt-1 grid">
          {(projects.data ?? []).slice(0, 6).map((project) => (
            <NavLink
              key={project.id}
              to={`/projects/${project.id}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "truncate rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground",
                  isActive && "bg-muted font-medium text-foreground",
                )
              }
            >
              {project.name}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="mt-auto p-3">
        {user?.role === "admin" ? (
          <Button variant="outline" className="w-full" asChild>
            <NavLink to="/team?invite=1" onClick={onNavigate}>
              Invite someone
            </NavLink>
          </Button>
        ) : (
          <p className="px-2 text-xs text-muted-foreground">{user?.email}</p>
        )}
      </div>
    </div>
  )
}

export function Shell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const debounced = useDebounced(query, 200)
  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api<SearchResult>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length >= 2,
  })

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 border-r bg-sidebar md:block">
        <SidebarNav />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:px-5">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search projects and tasks"
              className="pl-8"
              aria-label="Search"
            />
            {searchOpen && debounced.trim().length >= 2 ? (
              <div className="absolute top-10 z-40 w-full rounded-xl border bg-popover p-1 shadow-lg">
                {(search.data?.projects.length ?? 0) === 0 && (search.data?.tasks.length ?? 0) === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">No matches</p>
                ) : null}
                {search.data?.projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onMouseDown={() => navigate(`/projects/${project.id}`)}
                  >
                    <span className="text-xs text-muted-foreground">Project</span>
                    <span className="block truncate">{project.name}</span>
                  </button>
                ))}
                {search.data?.tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onMouseDown={() => navigate(`/projects/${task.project_id}?task=${task.id}`)}
                  >
                    <span className="text-xs text-muted-foreground">{task.project_name}</span>
                    <span className="block truncate">{task.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="ml-auto flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted">
                <Person id={user?.id} name={user?.name ?? "You"} />
                <span className="hidden text-sm font-medium sm:inline">{user?.name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate("/settings")}>Settings</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void logout()}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
