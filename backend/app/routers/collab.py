from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import get_current_user
from ..models import ChecklistItem, ProjectChecklist, ProjectNote, User
from ..schemas import ChecklistIn, ChecklistItemIn, ChecklistItemPatch, ChecklistOut, ChecklistPatch, NoteIn, NoteOut, NotePatch
from ..services import get_project, log_activity, notify, to_checklist, to_note, utcnow

router = APIRouter(prefix="/api", tags=["collaboration"])


def _note(db: Session, user: User, note_id: UUID) -> ProjectNote:
    note = db.scalar(select(ProjectNote).where(ProjectNote.id == note_id).options(selectinload(ProjectNote.author)))
    if note is None or note.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Note not found.")
    get_project(db, user, note.project_id)
    return note


def _checklist(db: Session, user: User, checklist_id: UUID) -> ProjectChecklist:
    cached = db.get(ProjectChecklist, checklist_id)
    if cached is not None:
        db.expire(cached)
    checklist = db.scalar(
        select(ProjectChecklist)
        .where(ProjectChecklist.id == checklist_id)
        .options(selectinload(ProjectChecklist.items).selectinload(ChecklistItem.completer))
    )
    if checklist is None:
        raise HTTPException(status_code=404, detail="Checklist not found.")
    get_project(db, user, checklist.project_id)
    return checklist


@router.get("/projects/{project_id}/notes", response_model=list[NoteOut])
def list_notes(project_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[NoteOut]:
    project = get_project(db, user, project_id)
    notes = db.scalars(
        select(ProjectNote)
        .where(ProjectNote.project_id == project.id, ProjectNote.deleted_at.is_(None))
        .options(selectinload(ProjectNote.author))
        .order_by(ProjectNote.created_at.desc())
    ).all()
    return [to_note(note) for note in notes]


@router.post("/projects/{project_id}/notes", response_model=NoteOut)
def create_note(
    project_id: UUID,
    payload: NoteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NoteOut:
    project = get_project(db, user, project_id)
    note = ProjectNote(
        project_id=project.id,
        author_id=user.id,
        title=payload.title.strip(),
        body=payload.body.strip(),
    )
    db.add(note)
    if project.owner_id != user.id:
        notify(
            db,
            project.owner_id,
            kind="note",
            title=f"New note · {project.name}",
            body=note.title or note.body[:180],
            link=f"/projects/{project.id}?view=notes",
        )
    log_activity(
        db,
        actor=user,
        action="note.created",
        summary=f"{user.name} added a note to {project.name}",
        project_id=project.id,
    )
    db.commit()
    db.refresh(note)
    note.author = user
    return to_note(note)


@router.patch("/notes/{note_id}", response_model=NoteOut)
def update_note(
    note_id: UUID,
    payload: NotePatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NoteOut:
    note = _note(db, user, note_id)
    if note.author_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="You can only edit your own notes.")
    data = payload.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        note.title = data["title"].strip()
    if "body" in data and data["body"] is not None:
        note.body = data["body"].strip()
    note.updated_at = utcnow()
    log_activity(db, actor=user, action="note.updated", summary=f"{user.name} edited a note", project_id=note.project_id)
    db.commit()
    db.refresh(note)
    return to_note(note)


@router.delete("/notes/{note_id}")
def delete_note(note_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    note = _note(db, user, note_id)
    if note.author_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="You can only delete your own notes.")
    note.deleted_at = utcnow()
    log_activity(db, actor=user, action="note.deleted", summary=f"{user.name} removed a note", project_id=note.project_id)
    db.commit()
    return {"ok": True}


@router.get("/projects/{project_id}/checklists", response_model=list[ChecklistOut])
def list_checklists(project_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ChecklistOut]:
    project = get_project(db, user, project_id)
    rows = db.scalars(
        select(ProjectChecklist)
        .where(ProjectChecklist.project_id == project.id)
        .options(selectinload(ProjectChecklist.items).selectinload(ChecklistItem.completer))
        .order_by(ProjectChecklist.created_at)
    ).all()
    return [to_checklist(row) for row in rows]


@router.post("/projects/{project_id}/checklists", response_model=ChecklistOut)
def create_checklist(
    project_id: UUID,
    payload: ChecklistIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChecklistOut:
    project = get_project(db, user, project_id)
    count = db.scalar(
        select(func.count()).select_from(ProjectChecklist).where(ProjectChecklist.project_id == project.id)
    ) or 0
    if count >= 20:
        raise HTTPException(status_code=400, detail="This project already has 20 checklists.")
    checklist = ProjectChecklist(project_id=project.id, title=payload.title.strip(), created_by=user.id)
    db.add(checklist)
    log_activity(
        db,
        actor=user,
        action="checklist.created",
        summary=f"{user.name} created the {payload.title.strip()} checklist",
        project_id=project.id,
    )
    db.commit()
    db.refresh(checklist)
    checklist.items = []
    return to_checklist(checklist)


@router.patch("/checklists/{checklist_id}", response_model=ChecklistOut)
def update_checklist(
    checklist_id: UUID,
    payload: ChecklistPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChecklistOut:
    checklist = _checklist(db, user, checklist_id)
    if payload.title:
        checklist.title = payload.title.strip()
        checklist.updated_at = utcnow()
    db.commit()
    return to_checklist(_checklist(db, user, checklist_id))


@router.delete("/checklists/{checklist_id}")
def delete_checklist(checklist_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    checklist = _checklist(db, user, checklist_id)
    if checklist.created_by != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="You can only delete checklists you created.")
    db.delete(checklist)
    db.commit()
    return {"ok": True}


@router.post("/checklists/{checklist_id}/items", response_model=ChecklistOut)
def add_item(
    checklist_id: UUID,
    payload: ChecklistItemIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChecklistOut:
    checklist = _checklist(db, user, checklist_id)
    if len(checklist.items) >= 50:
        raise HTTPException(status_code=400, detail="This checklist already has 50 items.")
    position = max((item.position for item in checklist.items), default=-1) + 1
    db.add(ChecklistItem(checklist_id=checklist.id, title=payload.title.strip(), position=position))
    checklist.updated_at = utcnow()
    db.commit()
    return to_checklist(_checklist(db, user, checklist_id))


@router.patch("/checklist-items/{item_id}", response_model=ChecklistOut)
def update_item(
    item_id: UUID,
    payload: ChecklistItemPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChecklistOut:
    item = db.scalar(select(ChecklistItem).where(ChecklistItem.id == item_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Checklist item not found.")
    checklist = _checklist(db, user, item.checklist_id)
    data = payload.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        item.title = data["title"].strip()
    if "is_done" in data and data["is_done"] is not None:
        item.is_done = data["is_done"]
        if item.is_done:
            item.completed_by = user.id
            item.completed_at = utcnow()
        else:
            item.completed_by = None
            item.completed_at = None
        log_activity(
            db,
            actor=user,
            action="checklist.item",
            summary=f"{user.name} {'completed' if item.is_done else 'reopened'} “{item.title}”",
            project_id=checklist.project_id,
        )
    checklist.updated_at = utcnow()
    db.commit()
    return to_checklist(_checklist(db, user, checklist.id))


@router.delete("/checklist-items/{item_id}", response_model=ChecklistOut)
def delete_item(item_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ChecklistOut:
    item = db.get(ChecklistItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Checklist item not found.")
    checklist_id = item.checklist_id
    _checklist(db, user, checklist_id)
    db.delete(item)
    db.commit()
    return to_checklist(_checklist(db, user, checklist_id))
