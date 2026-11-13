from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_current_user
from ..models import ActivityLog, Notification, Project, Task, User
from ..schemas import (
    ActivityOut,
    DashboardCounts,
    DashboardOut,
    HealthItem,
    NotificationList,
    NotificationOut,
    SearchOut,
)
from ..services import (
    accessible_project_ids,
    project_stats,
    refresh_deadline_notices,
    resolve_today,
    to_activity,
    to_project,
    to_task,
    utcnow,
    visible_tasks,
)

router = APIRouter(prefix="/api", tags=["dashboard"])


def _count_tasks(db: Session, user: User, *criteria) -> int:
    from sqlalchemy import false

    stmt = select(func.count()).select_from(Task).where(Task.deleted_at.is_(None), *criteria)
    allowed = accessible_project_ids(db, user)
    if allowed is not None:
        stmt = stmt.where(Task.project_id.in_(allowed) if allowed else false())
    return db.scalar(stmt) or 0


def _projects(db: Session, user: User) -> list[Project]:
    stmt = select(Project).where(Project.deleted_at.is_(None), Project.archived_at.is_(None))
    allowed = accessible_project_ids(db, user)
    if allowed is not None:
        from sqlalchemy import false

        stmt = stmt.where(Project.id.in_(allowed) if allowed else false())
    return list(db.scalars(stmt.order_by(Project.updated_at.desc())).all())


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(as_of: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> DashboardOut:
    today = resolve_today(as_of)
    refresh_deadline_notices(db, user, today)
    projects = _projects(db, user)
    stats = project_stats(db, [project.id for project in projects], today)
    cards = [to_project(db, project, today, stats.get(project.id, {})) for project in projects]
    active = [card for card in cards if card.status not in ("completed",)]
    active_ids = select(Project.id).where(Project.deleted_at.is_(None), Project.archived_at.is_(None))
    my_tasks = db.scalars(
        visible_tasks(db, user)
        .where(Task.assignee_id == user.id, Task.status != "done", Task.project_id.in_(active_ids))
        .order_by(Task.due_date.asc().nulls_last(), Task.updated_at.desc())
        .limit(8)
    ).all()
    upcoming = db.scalars(
        visible_tasks(db, user)
        .where(
            Task.status != "done",
            Task.project_id.in_(active_ids),
            Task.due_date.is_not(None),
            Task.due_date >= today,
            Task.due_date <= today.fromordinal(today.toordinal() + 7),
        )
        .order_by(Task.due_date.asc())
        .limit(8)
    ).all()
    allowed = accessible_project_ids(db, user)
    active_people = select(User.id).where(User.status == "active")
    activity_stmt = (
        select(ActivityLog)
        .where(or_(ActivityLog.actor_id.is_(None), ActivityLog.actor_id.in_(active_people)))
        .options(selectinload(ActivityLog.actor))
        .order_by(ActivityLog.created_at.desc())
        .limit(12)
    )
    if allowed is not None:
        from sqlalchemy import false

        activity_stmt = activity_stmt.where(ActivityLog.project_id.in_(allowed) if allowed else false())
    activity = [to_activity(entry) for entry in db.scalars(activity_stmt).all()]
    open_tasks = sum(card.open_tasks for card in cards)
    active_ids = select(Project.id).where(Project.deleted_at.is_(None), Project.archived_at.is_(None))
    return DashboardOut(
        counts=DashboardCounts(
            active_projects=sum(1 for card in cards if card.status not in ("completed",)),
            completed_projects=sum(1 for card in cards if card.status == "completed"),
            on_hold_projects=sum(1 for card in cards if card.status == "on_hold"),
            open_tasks=open_tasks,
            in_progress_tasks=_count_tasks(db, user, Task.status == "in_progress", Task.project_id.in_(active_ids)),
            overdue_tasks=sum(card.overdue_tasks for card in cards),
            open_bugs=sum(card.open_bugs for card in cards),
            assigned_to_me=_count_tasks(
                db, user, Task.assignee_id == user.id, Task.status != "done", Task.project_id.in_(active_ids)
            ),
        ),
        projects=active[:8],
        my_tasks=[to_task(task, today) for task in my_tasks],
        upcoming=[to_task(task, today) for task in upcoming],
        activity=activity,
        health=[
            HealthItem(
                id=card.id,
                name=card.name,
                status=card.status,
                progress=card.progress,
                overdue_tasks=card.overdue_tasks,
                open_bugs=card.open_bugs,
            )
            for card in cards
            if card.status != "completed"
        ][:8],
    )


@router.get("/activity", response_model=list[ActivityOut])
def activity(project_id: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ActivityOut]:
    from uuid import UUID

    from ..services import get_project

    active_people = select(User.id).where(User.status == "active")
    stmt = (
        select(ActivityLog)
        .where(or_(ActivityLog.actor_id.is_(None), ActivityLog.actor_id.in_(active_people)))
        .options(selectinload(ActivityLog.actor))
        .order_by(ActivityLog.created_at.desc())
        .limit(40)
    )
    if project_id:
        project = get_project(db, user, UUID(project_id))
        stmt = stmt.where(ActivityLog.project_id == project.id)
    else:
        allowed = accessible_project_ids(db, user)
        if allowed is not None:
            from sqlalchemy import false

            stmt = stmt.where(ActivityLog.project_id.in_(allowed) if allowed else false())
    return [to_activity(entry) for entry in db.scalars(stmt).all()]


@router.get("/notifications", response_model=NotificationList)
def notifications(as_of: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> NotificationList:
    today = resolve_today(as_of)
    refresh_deadline_notices(db, user, today)
    rows = db.scalars(
        select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(50)
    ).all()
    unread = sum(1 for row in rows if row.read_at is None)
    return NotificationList(
        items=[
            NotificationOut(
                id=row.id,
                kind=row.kind,
                title=row.title,
                body=row.body,
                link=row.link,
                read=row.read_at is not None,
                created_at=row.created_at,
            )
            for row in rows
        ],
        unread=unread,
    )


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def read_one(notification_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> NotificationOut:
    from uuid import UUID

    try:
        parsed = UUID(notification_id)
    except ValueError as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="Invalid notification.") from exc
    row = db.get(Notification, parsed)
    if row is None or row.user_id != user.id:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Notification not found.")
    if row.read_at is None:
        row.read_at = utcnow()
        db.commit()
    return NotificationOut(
        id=row.id, kind=row.kind, title=row.title, body=row.body, link=row.link, read=True, created_at=row.created_at
    )


@router.post("/notifications/read-all")
def read_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))).all()
    now = utcnow()
    for row in rows:
        row.read_at = now
    db.commit()
    return {"ok": True}


@router.get("/search", response_model=SearchOut)
def search(q: str = "", as_of: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> SearchOut:
    from sqlalchemy import or_

    today = resolve_today(as_of)
    query = q.strip()[:100]
    if len(query) < 2:
        return SearchOut(projects=[], tasks=[])
    like = f"%{query}%"
    projects = _projects(db, user)
    matched = [project for project in projects if query.lower() in project.name.lower() or query.lower() in (project.description or "").lower()]
    stats = project_stats(db, [project.id for project in matched[:6]], today)
    tasks = db.scalars(
        visible_tasks(db, user).where(or_(Task.title.ilike(like), Task.description.ilike(like))).limit(8)
    ).all()
    return SearchOut(
        projects=[to_project(db, project, today, stats.get(project.id, {})) for project in matched[:6]],
        tasks=[to_task(task, today) for task in tasks],
    )
