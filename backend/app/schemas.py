from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    email: str
    role: str
    status: str


class UserOut(UserBrief):
    title: str = ""
    created_at: datetime
    last_login_at: datetime | None = None


class AuthStatus(BaseModel):
    needs_setup: bool


class SetupIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


class ForgotIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    token: str
    password: str


class AcceptIn(BaseModel):
    token: str
    name: str = Field(min_length=1, max_length=120)
    password: str


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class InviteIn(BaseModel):
    email: str
    role: str = "member"
    name: str | None = Field(default=None, max_length=120)


class LinkOut(BaseModel):
    delivery: str
    url: str | None = None
    message: str


class InvitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    name: str | None
    role: str
    expires_at: datetime
    accepted_at: datetime | None
    created_at: datetime


class InvitePreview(BaseModel):
    email: str
    name: str | None
    role: str
    expired: bool
    accepted: bool


class MemberUpdate(BaseModel):
    role: str | None = None
    status: str | None = None


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    description: str = Field(default="", max_length=20000)
    owner_id: UUID | None = None
    status: str = "planning"
    priority: str = "medium"
    start_date: date | None = None
    target_date: date | None = None
    tags: list[str] = []
    member_ids: list[UUID] = []


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=140)
    description: str | None = Field(default=None, max_length=20000)
    owner_id: UUID | None = None
    status: str | None = None
    priority: str | None = None
    start_date: date | None = None
    target_date: date | None = None
    tags: list[str] | None = None
    member_ids: list[UUID] | None = None


class ProjectOut(BaseModel):
    id: UUID
    name: str
    description: str
    status: str
    priority: str
    start_date: date | None
    target_date: date | None
    tags: list[str]
    archived: bool
    created_at: datetime
    updated_at: datetime
    owner: UserBrief
    members: list[UserBrief]
    open_tasks: int
    done_tasks: int
    overdue_tasks: int
    open_bugs: int
    progress: int


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=20000)
    task_type: str = "task"
    assignee_id: UUID | None = None
    priority: str = "medium"
    status: str = "todo"
    start_date: date | None = None
    due_date: date | None = None
    estimate_hours: float | None = Field(default=None, ge=0, le=1000)
    tags: list[str] = []
    steps_to_reproduce: str = Field(default="", max_length=20000)
    expected_result: str = Field(default="", max_length=20000)
    actual_result: str = Field(default="", max_length=20000)
    severity: str | None = None
    resolution_notes: str = Field(default="", max_length=20000)


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20000)
    task_type: str | None = None
    assignee_id: UUID | None = None
    priority: str | None = None
    status: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimate_hours: float | None = Field(default=None, ge=0, le=1000)
    tags: list[str] | None = None
    steps_to_reproduce: str | None = Field(default=None, max_length=20000)
    expected_result: str | None = Field(default=None, max_length=20000)
    actual_result: str | None = Field(default=None, max_length=20000)
    severity: str | None = None
    resolution_notes: str | None = Field(default=None, max_length=20000)


class TaskOut(BaseModel):
    id: UUID
    project_id: UUID
    project_name: str
    title: str
    description: str
    task_type: str
    priority: str
    status: str
    start_date: date | None
    due_date: date | None
    estimate_hours: float | None
    tags: list[str]
    steps_to_reproduce: str
    expected_result: str
    actual_result: str
    severity: str | None
    resolution_notes: str
    overdue: bool
    created_at: datetime
    updated_at: datetime
    assignee: UserBrief | None
    creator: UserBrief


class BulkIn(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=100)
    status: str | None = None
    priority: str | None = None
    assignee_id: UUID | None = None
    clear_assignee: bool = False


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class CommentOut(BaseModel):
    id: UUID
    body: str
    created_at: datetime
    updated_at: datetime
    author: UserBrief


class AttachmentOut(BaseModel):
    id: UUID
    filename: str
    content_type: str
    size: int
    created_at: datetime


class NoteIn(BaseModel):
    title: str = Field(default="", max_length=160)
    body: str = Field(min_length=1, max_length=20000)


class NotePatch(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    body: str | None = Field(default=None, min_length=1, max_length=20000)


class NoteOut(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    body: str
    created_at: datetime
    updated_at: datetime
    author: UserBrief


class ChecklistItemIn(BaseModel):
    title: str = Field(min_length=1, max_length=240)


class ChecklistItemPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    is_done: bool | None = None


class ChecklistItemOut(BaseModel):
    id: UUID
    title: str
    is_done: bool
    position: int
    completed_at: datetime | None
    completer: UserBrief | None


class ChecklistIn(BaseModel):
    title: str = Field(min_length=1, max_length=140)


class ChecklistPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=140)


class ChecklistOut(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    created_at: datetime
    progress: int
    items: list[ChecklistItemOut]


class TestCaseIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    module: str = ""
    priority: str = "medium"
    case_type: str = "functional"
    preconditions: str = ""
    steps: str = ""
    expected_result: str = ""
    actual_result: str = ""
    status: str = "not_run"
    assignee_id: UUID | None = None
    comments: str = ""


class TestCasePatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    module: str | None = None
    priority: str | None = None
    case_type: str | None = None
    preconditions: str | None = None
    steps: str | None = None
    expected_result: str | None = None
    actual_result: str | None = None
    status: str | None = None
    assignee_id: UUID | None = None
    comments: str | None = None
    clear_assignee: bool = False


class TestCaseOut(BaseModel):
    id: UUID
    project_id: UUID
    code: str
    title: str
    module: str
    priority: str
    case_type: str
    preconditions: str
    steps: str
    expected_result: str
    actual_result: str
    status: str
    comments: str
    assignee: UserBrief | None
    updated_at: datetime


class TestCaseImportResult(BaseModel):
    created: int
    updated: int


class ActivityOut(BaseModel):
    id: UUID
    action: str
    summary: str
    project_id: UUID | None
    task_id: UUID | None
    created_at: datetime
    actor: UserBrief | None


class NotificationOut(BaseModel):
    id: UUID
    kind: str
    title: str
    body: str
    link: str
    read: bool
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    unread: int


class TeamMember(BaseModel):
    user: UserOut
    projects: list[dict]
    open_tasks: int
    done_tasks: int


class DashboardCounts(BaseModel):
    active_projects: int
    completed_projects: int
    on_hold_projects: int
    open_tasks: int
    in_progress_tasks: int
    overdue_tasks: int
    open_bugs: int
    assigned_to_me: int


class HealthItem(BaseModel):
    id: UUID
    name: str
    status: str
    progress: int
    overdue_tasks: int
    open_bugs: int


class SearchOut(BaseModel):
    projects: list[ProjectOut]
    tasks: list[TaskOut]


class DashboardOut(BaseModel):
    counts: DashboardCounts
    projects: list[ProjectOut]
    my_tasks: list[TaskOut]
    upcoming: list[TaskOut]
    activity: list[ActivityOut]
    health: list[HealthItem]
