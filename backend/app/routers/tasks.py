from uuid import UUID
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user
from ..models import Task, TaskAttachment, TaskComment, User
from ..schemas import AttachmentOut, BulkIn, CommentIn, CommentOut, TaskIn, TaskOut, TaskPatch
from ..security import clean_tags
from ..services import (
    STATUS_LABELS,
    active_user,
    check_dates,
    check_priority,
    check_severity,
    check_task_status,
    check_task_type,
    get_project,
    get_task,
    log_activity,
    notify,
    require_member,
    resolve_today,
    task_link,
    task_options,
    to_comment,
    to_task,
    utcnow,
    visible_tasks,
)

router = APIRouter(prefix="/api", tags=["tasks"])


def _apply(task: Task, data: dict) -> None:
    if "title" in data and data["title"] is not None:
        task.title = data["title"].strip()
    if "description" in data and data["description"] is not None:
        task.description = data["description"].strip()
    if "task_type" in data and data["task_type"] is not None:
        task.task_type = check_task_type(data["task_type"])
    if "priority" in data and data["priority"] is not None:
        task.priority = check_priority(data["priority"])
    if "status" in data and data["status"] is not None:
        task.status = check_task_status(data["status"])
    if "start_date" in data:
        task.start_date = data["start_date"]
    if "due_date" in data:
        task.due_date = data["due_date"]
    if "estimate_hours" in data:
        task.estimate_hours = data["estimate_hours"]
    if "tags" in data and data["tags"] is not None:
        task.tags = clean_tags(data["tags"])
    for field in ("steps_to_reproduce", "expected_result", "actual_result", "resolution_notes"):
        if field in data and data[field] is not None:
            setattr(task, field, data[field].strip())
    if "severity" in data:
        task.severity = check_severity(data["severity"])
    check_dates(task.start_date, task.due_date, "Due date")


def _set_assignee(db: Session, task: Task, assignee_id: UUID | None) -> None:
    if assignee_id is None:
        task.assignee_id = None
        return
    active_user(db, assignee_id)
    require_member(db, task.project_id, assignee_id)
    task.assignee_id = assignee_id


def _reload(db: Session, task_id: UUID) -> Task:
    cached = db.get(Task, task_id)
    if cached is not None:
        db.expire(cached)
    task = db.scalar(select(Task).where(Task.id == task_id).options(*task_options()))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")
    return task


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    project_id: UUID | None = None,
    assignee: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    task_type: str | None = None,
    q: str | None = None,
    overdue: bool = False,
    as_of: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TaskOut]:
    today = resolve_today(as_of)
    stmt = visible_tasks(db, user)
    if project_id:
        get_project(db, user, project_id)
        stmt = stmt.where(Task.project_id == project_id)
    if assignee == "me":
        stmt = stmt.where(Task.assignee_id == user.id)
    elif assignee:
        try:
            stmt = stmt.where(Task.assignee_id == UUID(assignee))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid assignee.") from exc
    if status:
        stmt = stmt.where(Task.status == check_task_status(status))
    if priority:
        stmt = stmt.where(Task.priority == check_priority(priority))
    if task_type:
        stmt = stmt.where(Task.task_type == check_task_type(task_type))
    if overdue:
        stmt = stmt.where(Task.status != "done", Task.due_date.is_not(None), Task.due_date < today)
    if q:
        like = f"%{q.strip()[:100]}%"
        stmt = stmt.where(or_(Task.title.ilike(like), Task.description.ilike(like)))
    tasks = db.scalars(stmt.order_by(Task.updated_at.desc()).limit(500)).all()
    return [to_task(task, today) for task in tasks]


@router.post("/projects/{project_id}/tasks", response_model=TaskOut)
def create_task(
    project_id: UUID,
    payload: TaskIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    as_of: str | None = None,
) -> TaskOut:
    today = resolve_today(as_of)
    project = get_project(db, user, project_id)
    task = Task(
        project_id=project.id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        task_type=check_task_type(payload.task_type),
        creator_id=user.id,
        priority=check_priority(payload.priority),
        status=check_task_status(payload.status),
        start_date=payload.start_date,
        due_date=payload.due_date,
        estimate_hours=payload.estimate_hours,
        tags=clean_tags(payload.tags),
        steps_to_reproduce=payload.steps_to_reproduce.strip(),
        expected_result=payload.expected_result.strip(),
        actual_result=payload.actual_result.strip(),
        severity=check_severity(payload.severity),
        resolution_notes=payload.resolution_notes.strip(),
    )
    check_dates(task.start_date, task.due_date, "Due date")
    db.add(task)
    db.flush()
    if payload.assignee_id:
        _set_assignee(db, task, payload.assignee_id)
        if payload.assignee_id != user.id:
            notify(
                db,
                payload.assignee_id,
                kind="assignment",
                title=f"Assigned to you · {task.title}",
                body=f"{user.name} assigned this in {project.name}.",
                link=task_link(task),
            )
    log_activity(
        db,
        actor=user,
        action="task.created",
        summary=f"{user.name} added “{task.title}”",
        project_id=project.id,
        task_id=task.id,
    )
    db.commit()
    return to_task(_reload(db, task.id), today)


@router.get("/tasks/{task_id}", response_model=TaskOut)
def get_one(
    task_id: UUID,
    as_of: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TaskOut:
    task = get_task(db, user, task_id)
    return to_task(task, resolve_today(as_of))


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: UUID,
    payload: TaskPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    as_of: str | None = None,
) -> TaskOut:
    today = resolve_today(as_of)
    task = get_task(db, user, task_id)
    data = payload.model_dump(exclude_unset=True)
    old_status = task.status
    old_assignee = task.assignee_id
    _apply(task, data)
    if "assignee_id" in data:
        _set_assignee(db, task, data["assignee_id"])
    task.updated_at = utcnow()
    if task.status != old_status:
        log_activity(
            db,
            actor=user,
            action="task.status",
            summary=f"{user.name} moved “{task.title}” to {STATUS_LABELS.get(task.status, task.status)}",
            project_id=task.project_id,
            task_id=task.id,
        )
        if task.assignee_id and task.assignee_id != user.id:
            notify(
                db,
                task.assignee_id,
                kind="status",
                title=f"Status changed · {task.title}",
                body=f"{user.name} moved it to {STATUS_LABELS.get(task.status, task.status)}.",
                link=task_link(task),
            )
    else:
        log_activity(
            db,
            actor=user,
            action="task.updated",
            summary=f"{user.name} updated “{task.title}”",
            project_id=task.project_id,
            task_id=task.id,
        )
    if task.assignee_id != old_assignee:
        if task.assignee_id and task.assignee_id != user.id:
            notify(
                db,
                task.assignee_id,
                kind="assignment",
                title=f"Assigned to you · {task.title}",
                body=f"{user.name} assigned this task to you.",
                link=task_link(task),
            )
        if old_assignee and old_assignee != user.id:
            notify(
                db,
                old_assignee,
                kind="reassignment",
                title=f"Reassigned · {task.title}",
                body=f"{user.name} reassigned this task.",
                link=task_link(task),
            )
        log_activity(
            db,
            actor=user,
            action="task.assigned",
            summary=f"{user.name} changed the assignee on “{task.title}”",
            project_id=task.project_id,
            task_id=task.id,
        )
    db.commit()
    return to_task(_reload(db, task.id), today)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    task = get_task(db, user, task_id)
    task.deleted_at = utcnow()
    task.updated_at = utcnow()
    log_activity(
        db,
        actor=user,
        action="task.deleted",
        summary=f"{user.name} deleted “{task.title}”",
        project_id=task.project_id,
        task_id=task.id,
    )
    db.commit()
    return {"ok": True}


@router.post("/tasks/bulk", response_model=list[TaskOut])
def bulk_update(
    payload: BulkIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    as_of: str | None = None,
) -> list[TaskOut]:
    today = resolve_today(as_of)
    if payload.status is None and payload.priority is None and payload.assignee_id is None and not payload.clear_assignee:
        raise HTTPException(status_code=422, detail="Choose a status, priority, or assignee.")
    updated: list[TaskOut] = []
    for task_id in payload.ids:
        task = get_task(db, user, task_id)
        if payload.status:
            task.status = check_task_status(payload.status)
        if payload.priority:
            task.priority = check_priority(payload.priority)
        if payload.clear_assignee:
            task.assignee_id = None
        elif payload.assignee_id:
            _set_assignee(db, task, payload.assignee_id)
            if payload.assignee_id != user.id:
                notify(
                    db,
                    payload.assignee_id,
                    kind="assignment",
                    title=f"Assigned to you · {task.title}",
                    body=f"{user.name} assigned this task to you.",
                    link=task_link(task),
                )
        task.updated_at = utcnow()
        log_activity(
            db,
            actor=user,
            action="task.updated",
            summary=f"{user.name} updated “{task.title}”",
            project_id=task.project_id,
            task_id=task.id,
        )
        updated.append(task.id)
    db.commit()
    rows = db.scalars(select(Task).where(Task.id.in_(updated)).options(*task_options())).all()
    return [to_task(task, today) for task in rows]


@router.get("/tasks/{task_id}/comments", response_model=list[CommentOut])
def list_comments(task_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[CommentOut]:
    task = get_task(db, user, task_id)
    comments = db.scalars(
        select(TaskComment)
        .where(TaskComment.task_id == task.id)
        .options(selectinload(TaskComment.author))
        .order_by(TaskComment.created_at)
    ).all()
    return [to_comment(comment) for comment in comments]


@router.post("/tasks/{task_id}/comments", response_model=CommentOut)
def add_comment(
    task_id: UUID,
    payload: CommentIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CommentOut:
    task = get_task(db, user, task_id)
    comment = TaskComment(task_id=task.id, author_id=user.id, body=payload.body.strip())
    db.add(comment)
    task.updated_at = utcnow()
    recipients = {task.assignee_id, task.creator_id} - {user.id, None}
    for person_id in recipients:
        notify(
            db,
            person_id,
            kind="comment",
            title=f"New comment · {task.title}",
            body=f"{user.name}: {comment.body[:180]}",
            link=task_link(task),
        )
    log_activity(
        db,
        actor=user,
        action="comment.created",
        summary=f"{user.name} commented on “{task.title}”",
        project_id=task.project_id,
        task_id=task.id,
    )
    db.commit()
    db.refresh(comment)
    comment.author = user
    return to_comment(comment)


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    comment = db.scalar(select(TaskComment).where(TaskComment.id == comment_id).options(selectinload(TaskComment.author)))
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found.")
    get_task(db, user, comment.task_id)
    if comment.author_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="You can only delete your own comments.")
    db.delete(comment)
    db.commit()
    return {"ok": True}


def _safe_filename(name: str | None) -> str:
    raw = Path(name or "file").name.replace("\x00", "")
    cleaned = "".join(ch for ch in raw if ch not in '\\/:*?"<>|\r\n')
    return (cleaned or "file")[:180]


@router.get("/tasks/{task_id}/attachments", response_model=list[AttachmentOut])
def list_attachments(task_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[AttachmentOut]:
    task = get_task(db, user, task_id)
    rows = db.scalars(
        select(TaskAttachment).where(TaskAttachment.task_id == task.id).order_by(TaskAttachment.created_at.desc())
    ).all()
    return [
        AttachmentOut(id=row.id, filename=row.filename, content_type=row.content_type, size=row.size, created_at=row.created_at)
        for row in rows
    ]


@router.post("/tasks/{task_id}/attachments", response_model=AttachmentOut)
async def upload_attachment(
    task_id: UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttachmentOut:
    task = get_task(db, user, task_id)
    count = db.scalar(select(func.count()).select_from(TaskAttachment).where(TaskAttachment.task_id == task.id)) or 0
    if count >= 10:
        raise HTTPException(status_code=400, detail="This task already has 10 attachments.")
    data = await file.read()
    settings = get_settings()
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty.")
    if len(data) > settings.upload_max_bytes:
        raise HTTPException(status_code=413, detail="Files must be 5 MB or smaller.")
    row = TaskAttachment(
        task_id=task.id,
        uploaded_by=user.id,
        filename=_safe_filename(file.filename),
        content_type=(file.content_type or "application/octet-stream")[:120],
        size=len(data),
        data=data,
    )
    db.add(row)
    log_activity(
        db,
        actor=user,
        action="attachment.added",
        summary=f"{user.name} attached a file to “{task.title}”",
        project_id=task.project_id,
        task_id=task.id,
    )
    db.commit()
    db.refresh(row)
    return AttachmentOut(id=row.id, filename=row.filename, content_type=row.content_type, size=row.size, created_at=row.created_at)


@router.get("/attachments/{attachment_id}")
def download_attachment(attachment_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    row = db.get(TaskAttachment, attachment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    get_task(db, user, row.task_id)
    filename = _safe_filename(row.filename).replace('"', "")
    return Response(
        content=bytes(row.data),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/attachments/{attachment_id}")
def delete_attachment(attachment_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    row = db.get(TaskAttachment, attachment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    get_task(db, user, row.task_id)
    if row.uploaded_by != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="You can only remove files you uploaded.")
    db.delete(row)
    db.commit()
    return {"ok": True}
