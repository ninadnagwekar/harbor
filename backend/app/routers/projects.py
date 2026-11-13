from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import false, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models import Project, ProjectMember, User
from ..schemas import ProjectIn, ProjectOut, ProjectPatch
from ..security import clean_tags
from ..services import (
    accessible_project_ids,
    active_user,
    check_dates,
    check_priority,
    check_project_status,
    ensure_membership,
    get_project,
    log_activity,
    project_stats,
    resolve_today,
    to_project,
    utcnow,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _replace_members(db: Session, project: Project, member_ids: list[UUID]) -> None:
    desired = {project.owner_id, *member_ids}
    for user_id in desired:
        active_user(db, user_id)
    current = list(db.scalars(select(ProjectMember).where(ProjectMember.project_id == project.id)).all())
    current_ids = {row.user_id for row in current}
    for row in current:
        if row.user_id not in desired:
            db.delete(row)
    for user_id in desired - current_ids:
        db.add(ProjectMember(project_id=project.id, user_id=user_id))


@router.get("", response_model=list[ProjectOut])
def list_projects(
    q: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    tag: str | None = None,
    archived: bool = False,
    as_of: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProjectOut]:
    today = resolve_today(as_of)
    stmt = select(Project).where(Project.deleted_at.is_(None))
    if archived:
        stmt = stmt.where(Project.archived_at.is_not(None))
    else:
        stmt = stmt.where(Project.archived_at.is_(None))
    allowed = accessible_project_ids(db, user)
    if allowed is not None:
        stmt = stmt.where(Project.id.in_(allowed) if allowed else false())
    if status:
        stmt = stmt.where(Project.status == check_project_status(status))
    if priority:
        stmt = stmt.where(Project.priority == check_priority(priority))
    if q:
        like = f"%{q.strip()[:100]}%"
        stmt = stmt.where(or_(Project.name.ilike(like), Project.description.ilike(like)))
    projects = list(db.scalars(stmt.order_by(Project.updated_at.desc())).all())
    if tag:
        needle = tag.strip().lower()
        projects = [project for project in projects if needle in (project.tags or [])]
    stats = project_stats(db, [project.id for project in projects], today)
    return [to_project(db, project, today, stats.get(project.id, {})) for project in projects]


@router.post("", response_model=ProjectOut)
def create_project(
    payload: ProjectIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    as_of: str | None = None,
) -> ProjectOut:
    today = resolve_today(as_of)
    owner = active_user(db, payload.owner_id) if payload.owner_id else admin
    check_dates(payload.start_date, payload.target_date, "Target date")
    project = Project(
        name=payload.name.strip(),
        description=payload.description.strip(),
        owner_id=owner.id,
        status=check_project_status(payload.status),
        priority=check_priority(payload.priority),
        start_date=payload.start_date,
        target_date=payload.target_date,
        tags=clean_tags(payload.tags),
    )
    db.add(project)
    db.flush()
    ensure_membership(db, project.id, owner.id)
    for member_id in payload.member_ids:
        if member_id != owner.id:
            person = active_user(db, member_id)
            ensure_membership(db, project.id, person.id)
    log_activity(
        db,
        actor=admin,
        action="project.created",
        summary=f"{admin.name} created {project.name}",
        project_id=project.id,
    )
    db.commit()
    db.refresh(project)
    return to_project(db, project, today)


@router.get("/{project_id}", response_model=ProjectOut)
def get_one(
    project_id: UUID,
    as_of: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    today = resolve_today(as_of)
    project = get_project(db, user, project_id)
    return to_project(db, project, today)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: UUID,
    payload: ProjectPatch,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    as_of: str | None = None,
) -> ProjectOut:
    today = resolve_today(as_of)
    project = get_project(db, admin, project_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        project.name = data["name"].strip()
    if "description" in data:
        project.description = data["description"].strip()
    if "status" in data and data["status"] is not None:
        project.status = check_project_status(data["status"])
    if "priority" in data and data["priority"] is not None:
        project.priority = check_priority(data["priority"])
    if "start_date" in data:
        project.start_date = data["start_date"]
    if "target_date" in data:
        project.target_date = data["target_date"]
    check_dates(project.start_date, project.target_date, "Target date")
    if "tags" in data and data["tags"] is not None:
        project.tags = clean_tags(data["tags"])
    if "owner_id" in data and data["owner_id"] is not None:
        owner = active_user(db, data["owner_id"])
        project.owner_id = owner.id
        ensure_membership(db, project.id, owner.id)
    if "member_ids" in data and data["member_ids"] is not None:
        _replace_members(db, project, data["member_ids"])
    project.updated_at = utcnow()
    log_activity(
        db,
        actor=admin,
        action="project.updated",
        summary=f"{admin.name} updated {project.name}",
        project_id=project.id,
    )
    db.commit()
    db.refresh(project)
    return to_project(db, project, today)


@router.post("/{project_id}/archive", response_model=ProjectOut)
def archive_project(
    project_id: UUID,
    archived: bool = Query(True),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ProjectOut:
    project = get_project(db, admin, project_id)
    project.archived_at = utcnow() if archived else None
    project.updated_at = utcnow()
    action = "project.archived" if archived else "project.restored"
    verb = "archived" if archived else "restored"
    log_activity(db, actor=admin, action=action, summary=f"{admin.name} {verb} {project.name}", project_id=project.id)
    db.commit()
    db.refresh(project)
    return to_project(db, project, resolve_today(None))


@router.delete("/{project_id}")
def delete_project(
    project_id: UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    project = get_project(db, admin, project_id)
    project.deleted_at = utcnow()
    project.updated_at = utcnow()
    log_activity(db, actor=admin, action="project.deleted", summary=f"{admin.name} deleted {project.name}", project_id=project.id)
    db.commit()
    return {"ok": True}
