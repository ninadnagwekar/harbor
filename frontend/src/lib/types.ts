export type Role = "admin" | "member"
export type UserStatus = "active" | "deactivated"
export type Priority = "low" | "medium" | "high" | "critical"
export type ProjectStatus = "not_started" | "planning" | "in_progress" | "on_hold" | "completed"
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "blocked" | "done"
export type TaskType = "task" | "bug" | "feature" | "improvement"
export type Severity = "minor" | "major" | "critical" | "blocker"

export type UserBrief = {
  id: string
  name: string
  email: string
  role: Role
  status: UserStatus
}

export type User = UserBrief & {
  title: string
  created_at: string
  last_login_at: string | null
}

export type Project = {
  id: string
  name: string
  description: string
  status: ProjectStatus
  priority: Priority
  start_date: string | null
  target_date: string | null
  tags: string[]
  archived: boolean
  created_at: string
  updated_at: string
  owner: UserBrief
  members: UserBrief[]
  open_tasks: number
  done_tasks: number
  overdue_tasks: number
  open_bugs: number
  progress: number
}

export type Task = {
  id: string
  project_id: string
  project_name: string
  title: string
  description: string
  task_type: TaskType
  priority: Priority
  status: TaskStatus
  start_date: string | null
  due_date: string | null
  estimate_hours: number | null
  tags: string[]
  steps_to_reproduce: string
  expected_result: string
  actual_result: string
  severity: Severity | null
  resolution_notes: string
  overdue: boolean
  created_at: string
  updated_at: string
  assignee: UserBrief | null
  creator: UserBrief
}

export type Comment = {
  id: string
  body: string
  created_at: string
  updated_at: string
  author: UserBrief
}

export type Attachment = {
  id: string
  filename: string
  content_type: string
  size: number
  created_at: string
}

export type Note = {
  id: string
  project_id: string
  title: string
  body: string
  created_at: string
  updated_at: string
  author: UserBrief
}

export type ChecklistItem = {
  id: string
  title: string
  is_done: boolean
  position: number
  completed_at: string | null
  completer: UserBrief | null
}

export type Checklist = {
  id: string
  project_id: string
  title: string
  created_at: string
  progress: number
  items: ChecklistItem[]
}

export type Activity = {
  id: string
  action: string
  summary: string
  project_id: string | null
  task_id: string | null
  created_at: string
  actor: UserBrief | null
}

export type Notice = {
  id: string
  kind: string
  title: string
  body: string
  link: string
  read: boolean
  created_at: string
}

export type TeamMember = {
  user: User
  projects: { id: string; name: string; status: string }[]
  open_tasks: number
  done_tasks: number
}

export type Dashboard = {
  counts: {
    active_projects: number
    completed_projects: number
    on_hold_projects: number
    open_tasks: number
    in_progress_tasks: number
    overdue_tasks: number
    open_bugs: number
    assigned_to_me: number
  }
  projects: Project[]
  my_tasks: Task[]
  upcoming: Task[]
  activity: Activity[]
  health: {
    id: string
    name: string
    status: ProjectStatus
    progress: number
    overdue_tasks: number
    open_bugs: number
  }[]
}

export type SearchResult = {
  projects: Project[]
  tasks: Task[]
}

export type TestCaseStatus = "not_run" | "pass" | "fail" | "blocked"
export type TestCaseType = "functional" | "regression" | "smoke" | "integration" | "ui"

export type TestCase = {
  id: string
  project_id: string
  code: string
  title: string
  module: string
  priority: Priority
  case_type: TestCaseType
  preconditions: string
  steps: string
  expected_result: string
  actual_result: string
  status: TestCaseStatus
  comments: string
  assignee: UserBrief | null
  updated_at: string
}

export type LinkResult = {
  delivery: string
  url: string | null
  message: string
}

export type TaskPatch = {
  title?: string
  description?: string
  task_type?: TaskType
  assignee_id?: string | null
  priority?: Priority
  status?: TaskStatus
  start_date?: string | null
  due_date?: string | null
  estimate_hours?: number | null
  tags?: string[]
  steps_to_reproduce?: string
  expected_result?: string
  actual_result?: string
  severity?: Severity | null
  resolution_notes?: string
}

export type Filters = {
  q: string
  assignee: string
  priority: string
  type: string
  status: string
  overdue: boolean
}

export const emptyFilters: Filters = {
  q: "",
  assignee: "all",
  priority: "all",
  type: "all",
  status: "all",
  overdue: false,
}
