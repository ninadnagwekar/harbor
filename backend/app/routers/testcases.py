import csv
import io
import re
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_current_user
from ..models import ProjectMember, TestCase, User
from ..schemas import TestCaseImportResult, TestCaseIn, TestCaseOut, TestCasePatch
from ..security import normalize_email
from ..services import brief, get_project, log_activity, utcnow

router = APIRouter(prefix="/api", tags=["test-cases"])

COLUMNS = [
    "Test Case ID",
    "Title",
    "Module",
    "Priority",
    "Type",
    "Preconditions",
    "Steps",
    "Expected Result",
    "Actual Result",
    "Status",
    "Assigned To",
    "Comments",
]
PRIORITIES = {"low", "medium", "high", "critical"}
TYPES = {"functional", "regression", "smoke", "integration", "ui"}
STATUSES = {
    "not run": "not_run",
    "not_run": "not_run",
    "pass": "pass",
    "passed": "pass",
    "fail": "fail",
    "failed": "fail",
    "blocked": "blocked",
}
MAX_ROWS = 500
MAX_BYTES = 1_000_000


def _case(db: Session, user: User, case_id: UUID) -> TestCase:
    row = db.scalar(select(TestCase).where(TestCase.id == case_id).options(selectinload(TestCase.assignee)))
    if row is None:
        raise HTTPException(status_code=404, detail="Test case not found.")
    get_project(db, user, row.project_id)
    return row


def _out(row: TestCase) -> TestCaseOut:
    return TestCaseOut(
        id=row.id,
        project_id=row.project_id,
        code=row.code,
        title=row.title,
        module=row.module or "",
        priority=row.priority,
        case_type=row.case_type,
        preconditions=row.preconditions or "",
        steps=row.steps or "",
        expected_result=row.expected_result or "",
        actual_result=row.actual_result or "",
        status=row.status,
        comments=row.comments or "",
        assignee=brief(row.assignee),
        updated_at=row.updated_at,
    )


def _choice(value: str, allowed: set[str], label: str, default: str) -> str:
    item = (value or "").strip().lower().replace(" ", "_")
    if not item:
        return default
    if item not in allowed:
        raise HTTPException(status_code=422, detail=f"{label} must be one of: {', '.join(sorted(allowed))}.")
    return item


def _status(value: str) -> str:
    key = " ".join((value or "").strip().lower().replace("_", " ").split())
    if not key:
        return "not_run"
    mapped = STATUSES.get(key)
    if mapped is None:
        raise HTTPException(status_code=422, detail="Status must be Not run, Pass, Fail, or Blocked.")
    return mapped


def _next_code(db: Session, project_id: UUID) -> str:
    codes = db.scalars(select(TestCase.code).where(TestCase.project_id == project_id)).all()
    numbers = [int(code[3:]) for code in codes if re.fullmatch(r"TC-\d+", code or "")]
    return f"TC-{max(numbers, default=0) + 1:03d}"


def _members(db: Session, project_id: UUID) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .join(ProjectMember, ProjectMember.user_id == User.id)
            .where(ProjectMember.project_id == project_id, User.status == "active")
        ).all()
    )


def _assignee(members: list[User], raw: str) -> User | None:
    text = " ".join((raw or "").split())
    if not text:
        return None
    try:
        email = normalize_email(text)
    except HTTPException:
        email = ""
    folded = text.casefold()
    for person in members:
        if email and person.email == email:
            return person
        if person.name.casefold() == folded:
            return person
    return None


def _apply(row: TestCase, payload: TestCaseIn | TestCasePatch, members: list[User]) -> None:
    data = payload.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        title = data["title"].strip()
        if not title:
            raise HTTPException(status_code=422, detail="A test case needs a title.")
        row.title = title
    if "module" in data and data["module"] is not None:
        row.module = data["module"].strip()[:120]
    if "priority" in data and data["priority"] is not None:
        row.priority = _choice(data["priority"], PRIORITIES, "Priority", "medium")
    if "case_type" in data and data["case_type"] is not None:
        row.case_type = _choice(data["case_type"], TYPES, "Type", "functional")
    for field in ("preconditions", "steps", "expected_result", "actual_result", "comments"):
        if field in data and data[field] is not None:
            setattr(row, field, data[field].strip())
    if "status" in data and data["status"] is not None:
        row.status = _status(data["status"])
    if data.get("clear_assignee"):
        row.assignee_id = None
    elif "assignee_id" in data:
        if data["assignee_id"] is None:
            row.assignee_id = None
        elif any(person.id == data["assignee_id"] for person in members):
            row.assignee_id = data["assignee_id"]
        else:
            raise HTTPException(status_code=422, detail="Assign the case to someone on this project.")
    row.updated_at = utcnow()


@router.get("/projects/{project_id}/test-cases", response_model=list[TestCaseOut])
def list_cases(project_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[TestCaseOut]:
    project = get_project(db, user, project_id)
    rows = db.scalars(
        select(TestCase)
        .where(TestCase.project_id == project.id)
        .options(selectinload(TestCase.assignee))
        .order_by(TestCase.position, TestCase.created_at)
    ).all()
    return [_out(row) for row in rows]


@router.post("/projects/{project_id}/test-cases", response_model=TestCaseOut)
def create_case(
    project_id: UUID,
    payload: TestCaseIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TestCaseOut:
    project = get_project(db, user, project_id)
    position = db.scalar(select(func.coalesce(func.max(TestCase.position), -1)).where(TestCase.project_id == project.id)) or -1
    row = TestCase(
        project_id=project.id,
        code=_next_code(db, project.id),
        title=payload.title.strip(),
        created_by=user.id,
        position=int(position) + 1,
    )
    _apply(row, payload, _members(db, project.id))
    db.add(row)
    log_activity(
        db,
        actor=user,
        action="testcase.created",
        summary=f"{user.name} added test case {row.code}",
        project_id=project.id,
    )
    db.commit()
    db.refresh(row)
    return _out(row)


@router.patch("/test-cases/{case_id}", response_model=TestCaseOut)
def update_case(
    case_id: UUID,
    payload: TestCasePatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TestCaseOut:
    row = _case(db, user, case_id)
    _apply(row, payload, _members(db, row.project_id))
    db.commit()
    db.refresh(row)
    return _out(row)


@router.delete("/test-cases/{case_id}")
def delete_case(case_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    row = _case(db, user, case_id)
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/projects/{project_id}/test-cases/export")
def export_cases(project_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    project = get_project(db, user, project_id)
    rows = db.scalars(
        select(TestCase)
        .where(TestCase.project_id == project.id)
        .options(selectinload(TestCase.assignee))
        .order_by(TestCase.position, TestCase.created_at)
    ).all()
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    status_label = {"not_run": "Not run", "pass": "Pass", "fail": "Fail", "blocked": "Blocked"}
    for row in rows:
        writer.writerow(
            {
                "Test Case ID": row.code,
                "Title": row.title,
                "Module": row.module,
                "Priority": row.priority.capitalize(),
                "Type": row.case_type.capitalize(),
                "Preconditions": row.preconditions,
                "Steps": row.steps,
                "Expected Result": row.expected_result,
                "Actual Result": row.actual_result,
                "Status": status_label.get(row.status, "Not run"),
                "Assigned To": row.assignee.email if row.assignee else "",
                "Comments": row.comments,
            }
        )
    filename = re.sub(r"[^A-Za-z0-9._-]+", "-", project.name).strip("-") or "project"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}-test-cases.csv"'},
    )


@router.post("/projects/{project_id}/test-cases/import", response_model=TestCaseImportResult)
async def import_cases(
    project_id: UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TestCaseImportResult:
    project = get_project(db, user, project_id)
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="That CSV is larger than 1 MB.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="Save the file as UTF-8 CSV.") from exc
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=422, detail="The CSV needs a header row.")
    headers = {name.strip().casefold(): name for name in reader.fieldnames if name}
    missing = [column for column in COLUMNS if column.casefold() not in headers]
    if missing:
        raise HTTPException(status_code=422, detail="Use the test case template. Missing: " + ", ".join(missing))

    def cell(row: dict[str, str | None], column: str) -> str:
        return (row.get(headers[column.casefold()]) or "").strip()

    existing = {
        case.code.casefold(): case
        for case in db.scalars(select(TestCase).where(TestCase.project_id == project.id)).all()
    }
    members = _members(db, project.id)
    created = 0
    updated = 0
    position = db.scalar(select(func.coalesce(func.max(TestCase.position), -1)).where(TestCase.project_id == project.id)) or -1
    seen = 0
    for record in reader:
        if not any((value or "").strip() for value in record.values()):
            continue
        seen += 1
        if seen > MAX_ROWS:
            raise HTTPException(status_code=422, detail="Import up to 500 test cases at a time.")
        title = cell(record, "Title")
        if not title:
            raise HTTPException(status_code=422, detail=f"Row {seen} needs a title.")
        numbers = [int(item.code[3:]) for item in existing.values() if re.fullmatch(r"TC-\d+", item.code or "")]
        code = cell(record, "Test Case ID") or f"TC-{max(numbers, default=0) + 1:03d}"
        if len(code) > 40:
            raise HTTPException(status_code=422, detail=f"Test case ID {code} is too long.")
        payload = TestCaseIn(
            title=title[:200],
            module=cell(record, "Module")[:120],
            priority=_choice(cell(record, "Priority"), PRIORITIES, "Priority", "medium"),
            case_type=_choice(cell(record, "Type"), TYPES, "Type", "functional"),
            preconditions=cell(record, "Preconditions"),
            steps=cell(record, "Steps"),
            expected_result=cell(record, "Expected Result"),
            actual_result=cell(record, "Actual Result"),
            status=_status(cell(record, "Status")),
            comments=cell(record, "Comments"),
        )
        person = _assignee(members, cell(record, "Assigned To"))
        row = existing.get(code.casefold())
        if row is None:
            position = int(position) + 1
            row = TestCase(project_id=project.id, code=code, title=title[:200], created_by=user.id, position=position)
            db.add(row)
            existing[code.casefold()] = row
            created += 1
        else:
            updated += 1
        _apply(row, payload, members)
        row.code = code
        row.assignee_id = person.id if person else None
    if created or updated:
        log_activity(
            db,
            actor=user,
            action="testcase.imported",
            summary=f"{user.name} imported {created + updated} test cases",
            project_id=project.id,
        )
    db.commit()
    return TestCaseImportResult(created=created, updated=updated)
