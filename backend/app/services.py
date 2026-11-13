import smtplib
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from uuid import UUID

from fastapi import HTTPException, Request
from sqlalchemy import false, func, select
from sqlalchemy.orm import Session, selectinload

from .config import get_settings
from .models import (
    PRIORITIES,
    PROJECT_STATUSES,
    SEVERITIES,
    TASK_STATUSES,
    TASK_TYPES,
    ActivityLog,
    Notification,
    Project,
    ProjectChecklist,
    ProjectMember,
    ProjectNote,
    Task,
    TaskComment,
    User,
)
from .schemas import (
    ActivityOut,
    ChecklistItemOut,
    ChecklistOut,
    CommentOut,
    NoteOut,
    ProjectOut,
    TaskOut,
    UserBrief,
)

STATUS_LABELS = {
    "backlog": "Backlog",
    "todo": "To do",
    "in_progress": "In progress",
    "in_review": "In review",
    "blocked": "Blocked",
    "done": "Done",
    "not_started": "Not started",
    "planning": "Planning",
    "on_hold": "On hold",
    "completed": "Completed",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_choice(value: str, choices: tuple[str, ...], label: str) -> str:
    if value not in choices:
        raise HTTPException(status_code=422, detail=f"Choose a valid {label}.")
    return value


def check_project_status(value: str) -> str:
    return ensure_choice(value, PROJECT_STATUSES, "project status")


def check_priority(value: str) -> str:
    return ensure_choice(value, PRIORITIES, "priority")


def check_task_status(value: str) -> str:
    return ensure_choice(value, TASK_STATUSES, "status")


def check_task_type(value: str) -> str:
    return ensure_choice(value, TASK_TYPES, "task type")


def check_severity(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return ensure_choice(value, SEVERITIES, "severity")


def check_dates(start: date | None, end: date | None, end_label: str) -> None:
    if start and end and end < start:
        raise HTTPException(status_code=422, detail=f"{end_label} cannot be earlier than the start date.")


def smtp_configured() -> bool:
    settings = get_settings()
    return bool(settings.smtp_host and settings.smtp_from)


def send_email(to: str, subject: str, body: str) -> bool:
    settings = get_settings()
    if not smtp_configured():
        return False
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = to
    message.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_tls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)
        return True
    except OSError:
        return False


def public_base(request: Request) -> str:
    settings = get_settings()
    if settings.app_base_url:
        return settings.app_base_url.rstrip("/")
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    return f"{proto}://{host}"


def brief(user: User | None) -> UserBrief | None:
    if user is None:
        return None
    return UserBrief.model_validate(user)


def log_activity(
    db: Session,
    *,
    actor: User | None,
    action: str,
    summary: str,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
    created_at: datetime | None = None,
) -> None:
    entry = ActivityLog(
        actor_id=actor.id if actor else None,
        project_id=project_id,
        task_id=task_id,
        action=action,
        summary=summary,
    )
    if created_at:
        entry.created_at = created_at
    db.add(entry)


def notify(
    db: Session,
    user_id: UUID | None,
    *,
    kind: str,
    title: str,
    body: str,
    link: str,
    dedupe_key: str | None = None,
) -> None:
    if user_id is None:
        return
    if dedupe_key:
        existing = db.scalar(
            select(Notification.id).where(Notification.user_id == user_id, Notification.dedupe_key == dedupe_key)
        )
        if existing:
            return
    db.add(
        Notification(
            user_id=user_id,
            kind=kind,
            title=title[:200],
            body=body,
            link=link[:300],
            dedupe_key=dedupe_key,
        )
    )


def task_link(task: Task) -> str:
    return f"/projects/{task.project_id}?task={task.id}&view=status"


def accessible_project_ids(db: Session, user: User) -> list[UUID] | None:
    """None means every non-deleted project (admin)."""
    if user.role == "admin":
        return None
    return list(
        db.scalars(select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)).all()
    )


def get_project(db: Session, user: User, project_id: UUID, *, include_archived: bool = True) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Project not found.")
    if not include_archived and project.archived_at is not None:
        raise HTTPException(status_code=404, detail="Project not found.")
    if user.role != "admin":
        member = db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
            )
        )
        if member is None:
            raise HTTPException(status_code=404, detail="Project not found.")
    return project


def active_user(db: Session, user_id: UUID) -> User:
    person = db.get(User, user_id)
    if person is None or person.status != "active":
        raise HTTPException(status_code=422, detail="That person is not an active team member.")
    return person


def require_member(db: Session, project_id: UUID, user_id: UUID) -> None:
    member = db.scalar(
        select(ProjectMember.id).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
    )
    if member is None:
        raise HTTPException(status_code=422, detail="Add this person to the project before assigning work.")


def ensure_membership(db: Session, project_id: UUID, user_id: UUID) -> None:
    existing = db.scalar(
        select(ProjectMember.id).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
    )
    if existing is None:
        db.add(ProjectMember(project_id=project_id, user_id=user_id))


def project_member_ids(db: Session, project_id: UUID) -> list[UUID]:
    return list(db.scalars(select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)).all())


def load_members(db: Session, project_id: UUID) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .join(ProjectMember, ProjectMember.user_id == User.id)
            .where(ProjectMember.project_id == project_id)
            .order_by(User.name)
        ).all()
    )


def project_stats(db: Session, project_ids: list[UUID], today: date) -> dict[UUID, dict[str, int]]:
    stats: dict[UUID, dict[str, int]] = {
        pid: {"open": 0, "done": 0, "total": 0, "overdue": 0, "bugs": 0} for pid in project_ids
    }
    if not project_ids:
        return stats
    rows = db.execute(
        select(Task.project_id, Task.status, func.count())
        .where(Task.project_id.in_(project_ids), Task.deleted_at.is_(None))
        .group_by(Task.project_id, Task.status)
    ).all()
    for project_id, status, count in rows:
        bucket = stats.setdefault(project_id, {"open": 0, "done": 0, "total": 0, "overdue": 0, "bugs": 0})
        bucket["total"] += count
        if status == "done":
            bucket["done"] += count
        else:
            bucket["open"] += count
    overdue_rows = db.execute(
        select(Task.project_id, func.count())
        .where(
            Task.project_id.in_(project_ids),
            Task.deleted_at.is_(None),
            Task.status != "done",
            Task.due_date.is_not(None),
            Task.due_date < today,
        )
        .group_by(Task.project_id)
    ).all()
    for project_id, count in overdue_rows:
        stats.setdefault(project_id, {"open": 0, "done": 0, "total": 0, "overdue": 0, "bugs": 0})["overdue"] = count
    bug_rows = db.execute(
        select(Task.project_id, func.count())
        .where(
            Task.project_id.in_(project_ids),
            Task.deleted_at.is_(None),
            Task.task_type == "bug",
            Task.status != "done",
        )
        .group_by(Task.project_id)
    ).all()
    for project_id, count in bug_rows:
        stats.setdefault(project_id, {"open": 0, "done": 0, "total": 0, "overdue": 0, "bugs": 0})["bugs"] = count
    return stats


def to_project(db: Session, project: Project, today: date, stats: dict | None = None) -> ProjectOut:
    if stats is None:
        stats = project_stats(db, [project.id], today).get(project.id, {})
    total = stats.get("total", 0)
    done = stats.get("done", 0)
    progress = round(done / total * 100) if total else 0
    owner = db.get(User, project.owner_id)
    if owner is None:
        raise HTTPException(status_code=500, detail="Project owner is missing.")
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description or "",
        status=project.status,
        priority=project.priority,
        start_date=project.start_date,
        target_date=project.target_date,
        tags=list(project.tags or []),
        archived=project.archived_at is not None,
        created_at=project.created_at,
        updated_at=project.updated_at,
        owner=UserBrief.model_validate(owner),
        members=[UserBrief.model_validate(person) for person in load_members(db, project.id)],
        open_tasks=stats.get("open", 0),
        done_tasks=done,
        overdue_tasks=stats.get("overdue", 0),
        open_bugs=stats.get("bugs", 0),
        progress=progress,
    )


def task_options():
    return (
        selectinload(Task.assignee),
        selectinload(Task.creator),
        selectinload(Task.project),
    )


def to_task(task: Task, today: date) -> TaskOut:
    overdue = bool(task.due_date and task.due_date < today and task.status != "done")
    return TaskOut(
        id=task.id,
        project_id=task.project_id,
        project_name=task.project.name if task.project else "",
        title=task.title,
        description=task.description or "",
        task_type=task.task_type,
        priority=task.priority,
        status=task.status,
        start_date=task.start_date,
        due_date=task.due_date,
        estimate_hours=task.estimate_hours,
        tags=list(task.tags or []),
        steps_to_reproduce=task.steps_to_reproduce or "",
        expected_result=task.expected_result or "",
        actual_result=task.actual_result or "",
        severity=task.severity,
        resolution_notes=task.resolution_notes or "",
        overdue=overdue,
        created_at=task.created_at,
        updated_at=task.updated_at,
        assignee=brief(task.assignee),
        creator=UserBrief.model_validate(task.creator),
    )


def get_task(db: Session, user: User, task_id: UUID) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id).options(*task_options()))
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found.")
    get_project(db, user, task.project_id)
    return task


def visible_tasks(db: Session, user: User):
    stmt = select(Task).where(Task.deleted_at.is_(None)).options(*task_options())
    ids = accessible_project_ids(db, user)
    if ids is not None:
        stmt = stmt.where(Task.project_id.in_(ids) if ids else false())
    alive = select(Project.id).where(Project.deleted_at.is_(None))
    return stmt.where(Task.project_id.in_(alive))


def refresh_deadline_notices(db: Session, user: User, today: date) -> None:
    soon = today + timedelta(days=2)
    tasks = db.scalars(
        select(Task)
        .where(
            Task.deleted_at.is_(None),
            Task.assignee_id == user.id,
            Task.status != "done",
            Task.due_date.is_not(None),
            Task.due_date <= soon,
        )
        .options(selectinload(Task.project))
    ).all()
    for task in tasks:
        if task.project is None or task.project.deleted_at is not None:
            continue
        if task.due_date < today:
            notify(
                db,
                user.id,
                kind="overdue",
                title=f"Overdue · {task.title}",
                body=f"This was due {task.due_date.day} {task.due_date.strftime('%b')}.",
                link=task_link(task),
                dedupe_key=f"overdue:{task.id}:{task.due_date.isoformat()}",
            )
        else:
            notify(
                db,
                user.id,
                kind="upcoming",
                title=f"Due soon · {task.title}",
                body=f"Due {task.due_date.day} {task.due_date.strftime('%b')}.",
                link=task_link(task),
                dedupe_key=f"upcoming:{task.id}:{task.due_date.isoformat()}",
            )
    db.commit()


def to_comment(comment: TaskComment) -> CommentOut:
    return CommentOut(
        id=comment.id,
        body=comment.body,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        author=UserBrief.model_validate(comment.author),
    )


def to_note(note: ProjectNote) -> NoteOut:
    return NoteOut(
        id=note.id,
        project_id=note.project_id,
        title=note.title or "",
        body=note.body,
        created_at=note.created_at,
        updated_at=note.updated_at,
        author=UserBrief.model_validate(note.author),
    )


def to_checklist(checklist: ProjectChecklist) -> ChecklistOut:
    items = []
    done = 0
    for item in checklist.items:
        if item.is_done:
            done += 1
        items.append(
            ChecklistItemOut(
                id=item.id,
                title=item.title,
                is_done=item.is_done,
                position=item.position,
                completed_at=item.completed_at,
                completer=brief(item.completer),
            )
        )
    total = len(items)
    return ChecklistOut(
        id=checklist.id,
        project_id=checklist.project_id,
        title=checklist.title,
        created_at=checklist.created_at,
        progress=round(done / total * 100) if total else 0,
        items=items,
    )


def to_activity(entry: ActivityLog) -> ActivityOut:
    return ActivityOut(
        id=entry.id,
        action=entry.action,
        summary=entry.summary,
        project_id=entry.project_id,
        task_id=entry.task_id,
        created_at=entry.created_at,
        actor=brief(entry.actor),
    )


def resolve_today(as_of: str | None) -> date:
    if not as_of:
        return date.today()
    try:
        parsed = date.fromisoformat(as_of)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Use a YYYY-MM-DD date.") from exc
    if abs((parsed - date.today()).days) > 2:
        raise HTTPException(status_code=422, detail="Use a YYYY-MM-DD date.")
    return parsed


def parse_uuid(value: str, label: str = "id") -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid {label}.") from exc
