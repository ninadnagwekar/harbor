from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .security import decode_access_token, read_session_token


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = read_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    subject = decode_access_token(token)
    if not subject:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    try:
        user_id = UUID(subject)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Sign in to continue.") from exc
    user = db.get(User, user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can do that.")
    return user
