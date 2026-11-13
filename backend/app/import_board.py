"""Load the GMG Order Entry sheet into the project board.

The sheet is the source for the first import only. Later edits in Harbor are left alone.
"""

import csv
import logging
import secrets
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Project, Task, TaskComment, User
from .security import hash_password
from .services import ensure_membership, log_activity, utcnow

logger = logging.getLogger("harbor")

CSV_PATH = Path(__file__).resolve().parents[1] / "data" / "gmg-order-entry-tasks.csv"
PROJECT_NAME = "GMG Order Entry"

STATUS = {
    "pending": "todo",
    "wip": "in_progress",
    "done for testing": "in_review",
    "rework": "blocked",
    "completed": "done",
}
PRIORITY = {"low": "low", "medium": "medium", "high": "high", "critical": "critical"}


def _key(name: str) -> str:
    return " ".join(name.replace(".", " ").split()).casefold()


def _parse_date(value: str) -> date | None:
    value = (value or "").strip()
    if not value:
        return None
    return datetime.strptime(value, "%m/%d/%Y").date()


def _parse_dt(value: str) -> datetime | None:
    day = _parse_date(value)
    if day is None:
        return None
    return datetime(day.year, day.month, day.day, 12, 0, tzinfo=timezone.utc)


def _people(raw: str) -> list[str]:
    raw = (raw or "").strip()
    if not raw or raw.casefold() == "unassigned":
        return []
    return [" ".join(part.split()) for part in raw.split(",") if part.strip()]


def _tags(raw: str) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for part in (raw or "").split(","):
        item = part.strip().lower()
        if not item or item in seen or len(item) > 24:
            continue
        seen.add(item)
        tags.append(item)
        if len(tags) == 8:
            break
    return tags


def _description(row: dict[str, str], parent: str, extras: list[str]) -> str:
    parts: list[str] = []
    if parent:
        parts.append(f"Part of: {parent}")
    if extras:
        parts.append("Also assigned to " + ", ".join(extras) + ".")
    body = (row.get("Description") or "").strip()
    remarks = (row.get("Remarks") or "").strip()
    if body:
        parts.append(body)
    if remarks and remarks != body:
        parts.append(remarks)
    return "\n\n".join(parts)


def _load_rows() -> list[dict[str, str]]:
    with CSV_PATH.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def _directory(db: Session) -> dict[str, User]:
    people = {_key(person.name): person for person in db.scalars(select(User)).all()}
    if "atul harle" not in people:
        atul = User(
            name="Atul Harle",
            email="atul.harle@powerweave.com",
            title="",
            password_hash=hash_password(secrets.token_urlsafe(24)),
            role="member",
            status="active",
        )
        db.add(atul)
        db.flush()
        people["atul harle"] = atul
    return people


def _project(db: Session, owner: User) -> Project:
    project = db.scalar(select(Project).where(Project.name == PROJECT_NAME, Project.deleted_at.is_(None)))
    if project is not None:
        return project
    today = utcnow().date()
    project = Project(
        name=PROJECT_NAME,
        description="Order entry work tracked from the GMG task sheet.",
        owner_id=owner.id,
        status="in_progress",
        priority="high",
        start_date=today,
        tags=["order-entry", "gmg"],
    )
    db.add(project)
    db.flush()
    ensure_membership(db, project.id, owner.id)
    return project


def import_gmg_board(db: Session) -> dict:
    if not CSV_PATH.is_file():
        return {"imported": False, "reason": "missing-file"}
    owner = db.scalar(select(User).where(User.email == "ninad.nagwekar@powerweave.com"))
    if owner is None:
        owner = db.scalar(select(User).where(User.role == "admin", User.status == "active"))
    if owner is None:
        return {"imported": False, "reason": "no-admin"}

    project = _project(db, owner)
    already = db.scalar(
        select(Task.id).where(Task.project_id == project.id, Task.external_id.is_not(None), Task.deleted_at.is_(None))
    )
    if already is not None:
        return {"imported": False, "reason": "already-loaded", "project_id": str(project.id)}

    rows = _load_rows()
    people = _directory(db)
    now = utcnow()
    for task in db.scalars(select(Task).where(Task.project_id == project.id, Task.deleted_at.is_(None))).all():
        task.deleted_at = now

    created = 0
    for row in rows:
        external_id = (row.get("ID") or "").strip()
        title = " ".join((row.get("Title") or "").split())
        if not external_id or not title:
            continue
        names = _people(row.get("Assignees") or "")
        matched = [people[key] for name in names if (key := _key(name)) in people]
        missing = [name for name in names if _key(name) not in people]
        assignee = matched[0] if matched else None
        extras = [person.name for person in matched[1:]] + missing
        creator_name = (row.get("Created by") or "").strip()
        creator = people.get(_key(creator_name), owner)
        status = STATUS.get((row.get("Status") or "").strip().casefold(), "todo")
        priority = PRIORITY.get((row.get("Priority") or "").strip().casefold(), "medium")
        created_at = _parse_dt(row.get("Created date") or "") or now
        updated_at = _parse_dt(row.get("Modified at") or "") or created_at
        task = Task(
            project_id=project.id,
            external_id=external_id,
            title=title[:200],
            description=_description(row, (row.get("Parent") or "").strip(), extras),
            task_type="task",
            assignee_id=assignee.id if assignee else None,
            creator_id=creator.id,
            priority=priority,
            status=status,
            start_date=_parse_date(row.get("Start date") or ""),
            due_date=_parse_date(row.get("Due date") or ""),
            tags=_tags(row.get("Labels") or ""),
            created_at=created_at,
            updated_at=updated_at,
        )
        db.add(task)
        db.flush()
        comment = (row.get("Last comment") or "").strip()
        if comment:
            commenter_name = (row.get("Modified by") or "").strip()
            commenter = people.get(_key(commenter_name), creator)
            db.add(
                TaskComment(
                    task_id=task.id,
                    author_id=commenter.id,
                    body=comment,
                    created_at=updated_at,
                    updated_at=updated_at,
                )
            )
        created += 1

    for person in people.values():
        if person.email.endswith("@powerweave.com") or person.email == "atul.harle@powerweave.com":
            ensure_membership(db, project.id, person.id)
    log_activity(
        db,
        actor=owner,
        action="project.imported",
        summary=f"Loaded {created} tasks from the GMG order entry sheet",
        project_id=project.id,
    )
    db.commit()
    logger.info("Imported %s GMG tasks into %s", created, project.id)
    return {"imported": True, "count": created, "project_id": str(project.id)}
