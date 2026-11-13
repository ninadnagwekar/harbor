import hashlib
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Request, Response

from .config import get_settings

COOKIE = "harbor_session"
_ATTEMPTS: dict[str, list[float]] = {}


def hash_password(password: str) -> str:
    # bcrypt only consumes 72 bytes. A SHA-256 digest keeps longer passwords intact.
    digest = hashlib.sha256(password.encode()).digest()
    return bcrypt.hashpw(digest, bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    digest = hashlib.sha256(password.encode()).digest()
    try:
        return bcrypt.checkpw(digest, hashed.encode())
    except ValueError:
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def create_access_token(user_id: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_exp_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> str | None:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None


def cookie_secure(request: Request) -> bool:
    settings = get_settings()
    if settings.cookie_secure:
        return True
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto == "https"


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
        max_age=settings.jwt_exp_minutes * 60,
        path="/",
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(COOKIE, path="/", secure=cookie_secure(request), samesite="lax")


def read_session_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(COOKIE)


def validate_password(password: str) -> str:
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Use at least 8 characters.")
    if len(password) > 200:
        raise HTTPException(status_code=422, detail="Password is too long.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise HTTPException(status_code=422, detail="Include at least one letter and one number.")
    return password


def normalize_email(email: str) -> str:
    value = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    return value


def clean_tags(tags: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        item = tag.strip().lower()
        if not item or item in seen:
            continue
        if len(item) > 24:
            raise HTTPException(status_code=422, detail="Tags must be 24 characters or fewer.")
        seen.add(item)
        cleaned.append(item)
        if len(cleaned) > 8:
            raise HTTPException(status_code=422, detail="Use at most 8 tags.")
    return cleaned


def rate_limit(key: str, limit: int = 8, window: int = 60) -> None:
    if get_settings().testing:
        return
    now = time.time()
    recent = [stamp for stamp in _ATTEMPTS.get(key, []) if now - stamp < window]
    if len(recent) >= limit:
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a minute and try again.")
    recent.append(now)
    _ATTEMPTS[key] = recent


def client_key(request: Request, bucket: str) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "local")
    return f"{bucket}:{ip}"
