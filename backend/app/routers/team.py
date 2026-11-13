from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, false, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models import ActivityLog, Invitation, Project, ProjectMember, Task, User
from ..routers.auth import create_reset_link
from ..schemas import InvitationOut, InviteIn, LinkOut, MemberUpdate, TeamMember, UserOut
from ..security import hash_token, new_token, normalize_email
from ..services import accessible_project_ids, public_base, send_email, smtp_configured, utcnow

router = APIRouter(prefix="/api/team", tags=["team"])


def _projects_for(db: Session, viewer: User, person: User) -> list[dict]:
    stmt = (
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == person.id, Project.deleted_at.is_(None))
        .order_by(Project.name)
    )
    allowed = accessible_project_ids(db, viewer)
    if allowed is not None:
        stmt = stmt.where(Project.id.in_(allowed) if allowed else false())
    return [{"id": str(project.id), "name": project.name, "status": project.status} for project in db.scalars(stmt).all()]


def _task_counts(db: Session, viewer: User, person: User) -> tuple[int, int]:
    stmt = select(Task.status, func.count()).where(Task.assignee_id == person.id, Task.deleted_at.is_(None)).group_by(Task.status)
    allowed = accessible_project_ids(db, viewer)
    if allowed is not None:
        stmt = stmt.where(Task.project_id.in_(allowed) if allowed else false())
    open_count = 0
    done_count = 0
    for status, count in db.execute(stmt).all():
        if status == "done":
            done_count += count
        else:
            open_count += count
    return open_count, done_count


@router.get("", response_model=list[TeamMember])
def list_team(viewer: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[TeamMember]:
    people = db.scalars(select(User).order_by(User.name)).all()
    result = []
    for person in people:
        open_count, done_count = _task_counts(db, viewer, person)
        result.append(
            TeamMember(
                user=UserOut.model_validate(person),
                projects=_projects_for(db, viewer, person),
                open_tasks=open_count,
                done_tasks=done_count,
            )
        )
    return result


@router.get("/invitations", response_model=list[InvitationOut])
def list_invitations(admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[Invitation]:
    return list(
        db.scalars(
            select(Invitation).where(Invitation.accepted_at.is_(None)).order_by(Invitation.created_at.desc())
        ).all()
    )


@router.post("/invite", response_model=LinkOut)
def invite(
    payload: InviteIn,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LinkOut:
    if payload.role not in ("admin", "member"):
        raise HTTPException(status_code=422, detail="Choose a valid role.")
    email = normalize_email(payload.email)
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        if existing.status == "deactivated":
            raise HTTPException(status_code=409, detail="This person is deactivated. Restore their account instead.")
        raise HTTPException(status_code=409, detail="That email already belongs to a team member.")
    settings = get_settings()
    token = new_token()
    pending = db.scalars(select(Invitation).where(Invitation.email == email, Invitation.accepted_at.is_(None))).all()
    for old in pending:
        db.delete(old)
    db.add(
        Invitation(
            email=email,
            name=(payload.name or "").strip() or None,
            role=payload.role,
            token_hash=hash_token(token),
            invited_by=admin.id,
            expires_at=utcnow() + timedelta(hours=settings.invite_exp_hours),
        )
    )
    url = f"{public_base(request)}/invite/{token}"
    sent = send_email(
        email,
        "You're invited to Harbor",
        (
            f"{admin.name} invited you to the Harbor workspace.\n\n"
            f"Set your password to join:\n{url}\n\n"
            f"This link expires in {settings.invite_exp_hours} hours.\n"
        ),
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not create that invitation.") from exc
    if sent:
        return LinkOut(delivery="email", url=None, message=f"Invitation sent to {email}.")
    return LinkOut(
        delivery="link",
        url=url,
        message="Email is not configured. Share this activation link. It expires in 72 hours.",
    )


@router.patch("/{user_id}", response_model=UserOut)
def update_member(
    user_id: str,
    payload: MemberUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    from ..services import parse_uuid

    person = db.get(User, parse_uuid(user_id, "member"))
    if person is None:
        raise HTTPException(status_code=404, detail="Team member not found.")
    if payload.role is not None:
        if payload.role not in ("admin", "member"):
            raise HTTPException(status_code=422, detail="Choose a valid role.")
        if person.id == admin.id and payload.role != "admin":
            raise HTTPException(status_code=400, detail="You cannot remove your own admin access.")
        if payload.role != "admin" and person.role == "admin":
            admins = db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.status == "active")) or 0
            if admins <= 1:
                raise HTTPException(status_code=400, detail="Keep at least one active admin.")
        person.role = payload.role
    if payload.status is not None:
        if payload.status not in ("active", "deactivated"):
            raise HTTPException(status_code=422, detail="Choose a valid status.")
        if person.id == admin.id and payload.status != "active":
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")
        if payload.status == "deactivated" and person.role == "admin":
            admins = db.scalar(
                select(func.count()).select_from(User).where(User.role == "admin", User.status == "active", User.id != person.id)
            ) or 0
            if admins < 1:
                raise HTTPException(status_code=400, detail="Keep at least one active admin.")
        person.status = payload.status
        if payload.status == "deactivated":
            db.execute(delete(ActivityLog).where(ActivityLog.actor_id == person.id))
    person.updated_at = utcnow()
    db.commit()
    db.refresh(person)
    return UserOut.model_validate(person)


@router.post("/{user_id}/reset-link", response_model=LinkOut)
def reset_link(
    user_id: str,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LinkOut:
    from ..services import parse_uuid

    person = db.get(User, parse_uuid(user_id, "member"))
    if person is None or person.status != "active":
        raise HTTPException(status_code=404, detail="Team member not found.")
    url = create_reset_link(db, request, person)
    db.commit()
    if smtp_configured() and url is None:
        return LinkOut(delivery="email", url=None, message=f"Reset link sent to {person.email}.")
    return LinkOut(
        delivery="link",
        url=url,
        message="Email is not configured. Share this reset link. It expires in 2 hours.",
    )
