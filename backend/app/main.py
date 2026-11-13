from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware

from .accounts import ensure_workspace_accounts
from .config import get_settings
from .database import Base, SessionLocal, engine, get_db
from .import_board import import_gmg_board
from .deps import require_admin
from .models import User
from .routers import auth, collab, dashboard, projects, tasks, team, testcases
from .sample import load_sample_workspace


def static_root() -> Path | None:
    settings = get_settings()
    if settings.static_dir:
        path = Path(settings.static_dir)
        return path if (path / "index.html").is_file() else None
    candidate = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return candidate if (candidate / "index.html").is_file() else None


def origin_allowed(request: Request, origin: str) -> bool:
    settings = get_settings()
    if origin in settings.cors_origin_list:
        return True
    parsed = urlparse(origin)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return False
    host = request.headers.get("host", "")
    forwarded = request.headers.get("x-forwarded-host", "")
    return parsed.netloc == host or (bool(forwarded) and parsed.netloc == forwarded)


class GuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.url.path.startswith("/api"):
            if request.headers.get("x-harbor-request") != "1":
                return JSONResponse({"detail": "Refresh the page and try that again."}, status_code=403)
            origin = request.headers.get("origin")
            if origin and not origin_allowed(request, origin):
                return JSONResponse({"detail": "This action was blocked."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS title VARCHAR(80) NOT NULL DEFAULT ''"))
        conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_id VARCHAR(40)"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_external_id ON tasks (external_id) "
                "WHERE external_id IS NOT NULL"
            )
        )
        conn.execute(
            text(
                "DELETE FROM activity_logs WHERE actor_id IN (SELECT id FROM users WHERE status <> 'active')"
            )
        )
    if not get_settings().testing:
        db = SessionLocal()
        try:
            ensure_workspace_accounts(db)
            import_gmg_board(db)
        finally:
            db.close()
    yield


app = FastAPI(title="Harbor", version="1.0.0", lifespan=lifespan)
_settings = get_settings()
app.add_middleware(GuardMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Harbor-Request", "Authorization"],
)

app.include_router(auth.router)
app.include_router(team.router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(collab.router)
app.include_router(testcases.router)
app.include_router(dashboard.router)


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, exc: RequestValidationError):
    parts: list[str] = []
    for error in exc.errors():
        loc = [str(item) for item in error.get("loc", []) if item not in ("body", "query")]
        message = error.get("msg", "Invalid value")
        parts.append(f"{' '.join(loc)}: {message}" if loc else message)
    return JSONResponse({"detail": "; ".join(parts) or "Check the form and try again."}, status_code=422)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/admin/sample-workspace")
def sample_workspace(admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict:
    return load_sample_workspace(db, admin)


def _safe_file(root: Path, full_path: str) -> Path | None:
    if not full_path or ".." in full_path.split("/"):
        return None
    candidate = (root / full_path).resolve()
    if not str(candidate).startswith(str(root.resolve())):
        return None
    if candidate.is_file():
        return candidate
    return None


@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found.")
    root = static_root()
    if root is None:
        return JSONResponse({"detail": "Harbor API is running."})
    asset = _safe_file(root, full_path)
    if asset is not None:
        return FileResponse(asset)
    return FileResponse(root / "index.html")
