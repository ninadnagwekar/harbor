"""Workspace accounts for the Powerweave team.

Passwords are read from HARBOR_SEED_PASSWORDS (one email=password pair per line)
and are applied only when an account is created. Later password changes stay put.
Without that variable, existing accounts are left as they are and no new ones are created.
"""

import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Project, Team, TeamMembership, User
from .security import hash_password
from .services import ensure_membership, utcnow

SERVICES_TEAM = "Services AI Automation"

PLACEHOLDER_ADMIN = "asha@harbor.example"

# email, name, role, title
ACCOUNTS = (
    ("ninad.nagwekar@powerweave.com", "Ninad Nagwekar", "admin", "Admin"),
    ("abhimanyu.patil@powerweave.com", "Abhimanyu Patil", "member", "Jr. Backend Developer"),
    ("chandrakant.singh@powerweave.com", "Chandrakant Singh", "member", "Sr. Backend Developer"),
    ("pallavi.joshi@powerweave.com", "Pallavi Joshi", "member", "QA"),
    ("saket.yadav@powerweave.com", "Saket Yadav", "member", "Sr. Backend Developer"),
)


def _seed_pieces(raw: str) -> list[str]:
    pieces: list[str] = []
    for line in raw.replace("\\n", "\n").splitlines():
        line = line.strip().strip('"').strip("'")
        if not line or line.startswith("#"):
            continue
        for piece in line.split(";"):
            piece = piece.strip().strip('"').strip("'")
            if piece and not piece.startswith("#"):
                pieces.append(piece)
    return pieces


def seed_passwords() -> dict[str, str]:
    from .config import get_settings

    found: dict[str, str] = {}
    raw = os.environ.get("HARBOR_SEED_PASSWORDS", "") or get_settings().harbor_seed_passwords
    for piece in _seed_pieces(raw):
        if "=" not in piece:
            continue
        email, password = piece.split("=", 1)
        email = email.strip().lower()
        password = password.strip()
        if email and password:
            found[email] = password
    return found


def _apply(person: User, name: str, role: str, title: str, password: str | None) -> None:
    person.name = name
    person.title = title
    person.status = "active"
    if person.role != "admin" or role == "admin":
        person.role = role
    if password is not None:
        person.password_hash = hash_password(password)


def ensure_workspace_accounts(db: Session) -> None:
    passwords = seed_passwords()
    admin_email, admin_name, admin_role, admin_title = ACCOUNTS[0]
    admin_password = passwords.get(admin_email)
    admin = db.scalar(select(User).where(User.email == admin_email))
    placeholder = db.scalar(select(User).where(User.email == PLACEHOLDER_ADMIN))
    if admin is None and placeholder is not None and admin_password:
        placeholder.email = admin_email
        _apply(placeholder, admin_name, admin_role, admin_title, admin_password)
        admin = placeholder
    elif admin is None and admin_password:
        admin = User(
            email=admin_email,
            name=admin_name,
            title=admin_title,
            password_hash=hash_password(admin_password),
            role=admin_role,
            status="active",
        )
        db.add(admin)
        db.flush()
    elif admin is not None:
        _apply(admin, admin_name, admin_role, admin_title, None)

    for email, name, role, title in ACCOUNTS[1:]:
        person = db.scalar(select(User).where(User.email == email))
        password = passwords.get(email)
        if person is None:
            if not password:
                continue
            person = User(
                email=email,
                name=name,
                title=title,
                password_hash=hash_password(password),
                role=role,
                status="active",
            )
            db.add(person)
            db.flush()
        else:
            _apply(person, name, role, title, None)

    emails = [row[0] for row in ACCOUNTS]
    people = list(db.scalars(select(User).where(User.email.in_(emails))).all())
    if admin is not None:
        _ensure_services_team(db, admin, [person for person in people if person.id != admin.id])
        db.flush()
    projects = list(db.scalars(select(Project).where(Project.deleted_at.is_(None))).all())
    for project in projects:
        for person in people:
            ensure_membership(db, project.id, person.id)
    db.commit()


def _ensure_services_team(db: Session, lead: User, members: list[User]) -> None:
    team = db.scalar(select(Team).where(Team.name == SERVICES_TEAM))
    if team is None:
        team = Team(name=SERVICES_TEAM, lead_id=lead.id)
        db.add(team)
        db.flush()
    elif team.lead_id != lead.id:
        team.lead_id = lead.id
    for person in [lead, *members]:
        already = db.scalar(
            select(TeamMembership.id).where(TeamMembership.team_id == team.id, TeamMembership.user_id == person.id)
        )
        if already is None:
            db.add(TeamMembership(team_id=team.id, user_id=person.id))

    project = db.scalar(select(Project).where(Project.name == SERVICES_TEAM, Project.deleted_at.is_(None)))
    if project is None:
        project = Project(
            name=SERVICES_TEAM,
            description="Ninad Nagwekar's Services AI Automation team.",
            owner_id=lead.id,
            status="in_progress",
            priority="medium",
            start_date=utcnow().date(),
            tags=["services-ai-automation"],
        )
        db.add(project)
        db.flush()
    for person in [lead, *members]:
        ensure_membership(db, project.id, person.id)
