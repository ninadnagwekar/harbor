from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user
from ..models import Invitation, PasswordReset, User
from ..schemas import AcceptIn, AuthStatus, ForgotIn, InvitePreview, LoginIn, PasswordChangeIn, ProfileIn, ResetIn, SetupIn, UserOut
from ..security import (
    clear_session_cookie,
    client_key,
    create_access_token,
    hash_password,
    hash_token,
    new_token,
    normalize_email,
    rate_limit,
    set_session_cookie,
    validate_password,
    verify_password,
)
from ..services import public_base, send_email, smtp_configured, utcnow

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _issue(response: Response, request: Request, user: User) -> UserOut:
    user.last_login_at = utcnow()
    set_session_cookie(response, request, create_access_token(str(user.id)))
    return UserOut.model_validate(user)


@router.get("/status", response_model=AuthStatus)
def status(db: Session = Depends(get_db)) -> AuthStatus:
    count = db.scalar(select(func.count()).select_from(User)) or 0
    return AuthStatus(needs_setup=count == 0)


@router.post("/setup", response_model=UserOut)
def setup(payload: SetupIn, request: Request, response: Response, db: Session = Depends(get_db)) -> UserOut:
    count = db.scalar(select(func.count()).select_from(User)) or 0
    if count:
        raise HTTPException(status_code=403, detail="This workspace already has an administrator.")
    rate_limit(client_key(request, "setup"), limit=5)
    user = User(
        name=payload.name.strip(),
        email=normalize_email(payload.email),
        password_hash=hash_password(validate_password(payload.password)),
        role="admin",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _issue(response, request, user)


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> UserOut:
    rate_limit(client_key(request, "login"))
    email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="This account is deactivated. Ask an admin to restore it.")
    db.commit()
    return _issue(response, request, user)


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    clear_session_cookie(response, request)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_me(payload: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserOut:
    user.name = payload.name.strip()
    user.updated_at = utcnow()
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/change-password")
def change_password(
    payload: PasswordChangeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    user.password_hash = hash_password(validate_password(payload.new_password))
    user.updated_at = utcnow()
    db.commit()
    return {"ok": True}


@router.get("/invite/{token}", response_model=InvitePreview)
def preview_invite(token: str, db: Session = Depends(get_db)) -> InvitePreview:
    invite = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    if invite is None:
        raise HTTPException(status_code=404, detail="This invitation is not valid.")
    return InvitePreview(
        email=invite.email,
        name=invite.name,
        role=invite.role,
        expired=invite.expires_at < utcnow(),
        accepted=invite.accepted_at is not None,
    )


@router.post("/accept", response_model=UserOut)
def accept(payload: AcceptIn, request: Request, response: Response, db: Session = Depends(get_db)) -> UserOut:
    rate_limit(client_key(request, "accept"), limit=8)
    invite = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(payload.token)))
    if invite is None or invite.accepted_at is not None:
        raise HTTPException(status_code=400, detail="This invitation is not valid.")
    if invite.expires_at < utcnow():
        raise HTTPException(status_code=400, detail="This invitation has expired. Ask an admin for a new one.")
    existing = db.scalar(select(User).where(User.email == invite.email))
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(
        name=payload.name.strip(),
        email=invite.email,
        password_hash=hash_password(validate_password(payload.password)),
        role=invite.role,
        status="active",
    )
    invite.accepted_at = utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return _issue(response, request, user)


@router.post("/forgot")
def forgot(payload: ForgotIn, request: Request, db: Session = Depends(get_db)) -> dict:
    rate_limit(client_key(request, "forgot"), limit=5)
    message = "If an account exists, a reset link is on its way. If email is not set up, ask an admin."
    try:
        email = normalize_email(payload.email)
    except HTTPException:
        return {"ok": True, "message": message}
    user = db.scalar(select(User).where(User.email == email, User.status == "active"))
    if user and smtp_configured():
        _send_reset(db, request, user)
        db.commit()
    return {"ok": True, "message": message}


@router.post("/reset", response_model=UserOut)
def reset(payload: ResetIn, request: Request, response: Response, db: Session = Depends(get_db)) -> UserOut:
    rate_limit(client_key(request, "reset"), limit=8)
    row = db.scalar(select(PasswordReset).where(PasswordReset.token_hash == hash_token(payload.token)))
    if row is None or row.used_at is not None or row.expires_at < utcnow():
        raise HTTPException(status_code=400, detail="This reset link is not valid.")
    user = db.get(User, row.user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=400, detail="This reset link is not valid.")
    user.password_hash = hash_password(validate_password(payload.password))
    user.updated_at = utcnow()
    row.used_at = utcnow()
    db.commit()
    db.refresh(user)
    return _issue(response, request, user)


def _send_reset(db: Session, request, user: User) -> str | None:
    settings = get_settings()
    for old in db.scalars(select(PasswordReset).where(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None))).all():
        old.used_at = utcnow()
    token = new_token()
    db.add(
        PasswordReset(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(hours=settings.reset_exp_hours),
        )
    )
    url = f"{public_base(request)}/reset/{token}"
    sent = send_email(
        user.email,
        "Reset your Harbor password",
        f"Hi {user.name},\n\nSet a new password for Harbor:\n{url}\n\nThis link expires in {settings.reset_exp_hours} hours.\n",
    )
    return None if sent else url


def create_reset_link(db: Session, request, user: User) -> str | None:
    return _send_reset(db, request, user)
