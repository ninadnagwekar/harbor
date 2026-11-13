import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ChecklistItem, Project, ProjectChecklist, ProjectNote, Task, TaskComment, User
from .security import hash_password
from .services import ensure_membership, log_activity, utcnow

SAMPLE_NAME = "GMG Order Entry"

PEOPLE = [
    ("anika", "Anika Patel", "anika.patel@gmg.example"),
    ("rohan", "Rohan Mehta", "rohan.mehta@gmg.example"),
    ("meera", "Meera Shah", "meera.shah@gmg.example"),
    ("arjun", "Arjun Desai", "arjun.desai@gmg.example"),
]

TASKS = [
    ("Add refresh button", "todo", "task", "medium", "anika", 5, ["frontend"], "Add a refresh control on the order list so sales can pull the latest rows without reloading the page."),
    ("Mailbox SOPs for art, sales, and order", "todo", "task", "medium", "meera", 8, ["docs"], "Write the shared mailbox steps for art requests, sales questions, and order exceptions."),
    ("Sandbox testing — minimum 200 POs", "todo", "task", "high", "rohan", 2, ["uat"], "Run the sandbox against at least 200 purchase orders and note anything that fails extraction."),
    ("New model accuracy", "todo", "improvement", "high", "arjun", 10, ["extraction"], "Compare the new extraction model against the last production week and record the accuracy delta."),
    ("Production deployment", "todo", "task", "critical", "anika", 14, ["infra"], "Prepare the production cutover once UAT signs off."),
    ("QLP links", "todo", "task", "low", "meera", None, ["frontend"], "Confirm QLP document links open the right file for each order."),
    ("Dropdowns — fetch master data as JSON", "in_progress", "feature", "high", "rohan", 4, ["api"], "Create the functions that load customer, item, and shipper master data as JSON for the dropdowns."),
    ("Add dropdowns wherever they apply", "in_progress", "task", "medium", "anika", -2, ["frontend"], "Replace free-text fields with the new dropdowns on the order form."),
    ("Click-to-locate text in PDF and image", "in_progress", "feature", "high", "arjun", 1, ["frontend"], "Clicking a extracted value should scroll the preview to the matching region."),
    ("CSV and Excel export for the order list", "in_progress", "feature", "medium", "rohan", 4, ["api"], "Backend export of the current order list to CSV and Excel."),
    ("Confirm console and schema logs on Excel export", "in_progress", "bug", "high", "rohan", -1, ["api"], "Excel export should write a console line and a schema log. Right now the file downloads with no log entry."),
    ("Add repeat-order data in the processed folder", "in_review", "task", "medium", "anika", 3, ["api"], "When an order is marked repeat, copy the prior payload into the processed folder."),
    ("Hide rows when required is false", "in_review", "bug", "medium", "meera", None, ["frontend"], "Rows with required=false still render in yellow. They should stay hidden."),
    ("Preview PDF and email body changes", "in_review", "improvement", "medium", "arjun", 6, ["api"], "The preview PDF and the outbound email body need to use the same item table."),
    ("Keep pagination active when the order filter changes", "blocked", "bug", "high", "anika", 1, ["frontend"], "Next and Previous should stay available after the order filter changes. Today they reset to disabled."),
    ("Autocomplete for customers and items", "blocked", "bug", "medium", "rohan", None, ["frontend"], "Autocomplete returns stale customers after a filter change."),
    ("Daily access log and an Excel entry per order", "blocked", "task", "medium", "meera", 5, ["docs"], "Write a text access log per day and one Excel row per order."),
    ("Fetch previous order details for repeat orders", "blocked", "feature", "high", "arjun", 3, ["api"], "A repeat order should prefill from the previous matching PO."),
    ("Set up S3 and EC2 for order documents", "blocked", "task", "critical", "anika", 6, ["infra"], "Stand up the bucket and the app host before the document cutover."),
    ("Jotters with pen change", "done", "task", "low", "meera", -12, ["frontend"], "Pen annotation on jotters now saves with the order."),
    ("Third-party shipper number is missing", "done", "bug", "high", "rohan", -8, ["extraction"], "Shipper number was dropped when the carrier was not in the master list."),
    ("Handle order number formatting", "done", "bug", "medium", "anika", -9, ["api"], "Order numbers with a trailing letter were rejected."),
    ("API changes before the restructure", "done", "improvement", "medium", "arjun", -15, ["api"], "Landed the response shape the new order screen expects."),
    ("Quantity issues in extraction logic", "done", "bug", "high", "rohan", -6, ["extraction"], "Quantities with a thousands separator were parsed as 1."),
    ("Paste S3 document links into the order", "done", "task", "low", "meera", -4, ["infra"], "Document links can be pasted onto the order and opened later."),
    ("Audit duplicate PO numbers", "backlog", "task", "medium", "arjun", None, ["uat"], "Find purchase orders that were entered twice during the mailbox pilot."),
    ("Document the order status map", "backlog", "task", "low", "meera", None, ["docs"], "Write down which internal statuses match the customer-facing ones."),
]


def load_sample_workspace(db: Session, admin: User) -> dict:
    existing = db.scalar(select(Project).where(Project.name == SAMPLE_NAME, Project.deleted_at.is_(None)))
    if existing:
        return {"created": False, "project_id": str(existing.id)}

    people: dict[str, User] = {"admin": admin}
    for key, name, email in PEOPLE:
        person = db.scalar(select(User).where(User.email == email))
        if person is None:
            person = User(
                name=name,
                email=email,
                password_hash=hash_password(secrets.token_urlsafe(24)),
                role="member",
                status="active",
            )
            db.add(person)
            db.flush()
        people[key] = person

    today = utcnow().date()
    project = Project(
        name=SAMPLE_NAME,
        description="Internal workspace for art, sales, and order entry. Track the rollout, the extraction bugs, and what still has to clear UAT.",
        owner_id=admin.id,
        status="in_progress",
        priority="high",
        start_date=today - timedelta(days=21),
        target_date=today + timedelta(days=28),
        tags=["order-entry", "gmg", "uat"],
    )
    db.add(project)
    db.flush()
    for person in people.values():
        ensure_membership(db, project.id, person.id)

    created: dict[str, Task] = {}
    for title, status, task_type, priority, assignee, due, tags, description in TASKS:
        task = Task(
            project_id=project.id,
            title=title,
            description=description,
            task_type=task_type,
            assignee_id=people[assignee].id,
            creator_id=admin.id,
            priority=priority,
            status=status,
            due_date=None if due is None else today + timedelta(days=due),
            tags=tags,
            severity="major" if task_type == "bug" and priority in ("high", "critical") else ("minor" if task_type == "bug" else None),
        )
        if task_type == "bug" and status != "done":
            task.steps_to_reproduce = "Open an order that matches the report, change the filter, and repeat the action once."
            task.expected_result = "The field or control behaves the way the ticket describes."
            task.actual_result = description
        if status == "done" and task_type == "bug":
            task.resolution_notes = "Fixed and checked against the sample orders from last week."
        db.add(task)
        created[title] = task
    db.flush()

    review = Task(
        project_id=project.id,
        title="Review the production deployment checklist",
        description="Walk the deployment checklist before the cutover window and mark anything still open.",
        task_type="task",
        assignee_id=admin.id,
        creator_id=admin.id,
        priority="high",
        status="todo",
        due_date=today + timedelta(days=2),
        tags=["uat"],
    )
    bucket = Task(
        project_id=project.id,
        title="Confirm the S3 bucket policy",
        description="The document bucket should allow the app role to read and write order files, and nothing else.",
        task_type="task",
        assignee_id=admin.id,
        creator_id=people["anika"].id,
        priority="critical",
        status="in_progress",
        due_date=today - timedelta(days=1),
        tags=["infra"],
    )
    db.add(review)
    db.add(bucket)
    db.flush()

    shipper = created["Third-party shipper number is missing"]
    db.add(
        TaskComment(
            task_id=shipper.id,
            author_id=people["rohan"].id,
            body="The parser skipped the shipper line when the carrier code was missing from master data. It now keeps the raw number and flags it.",
        )
    )
    db.add(
        TaskComment(
            task_id=bucket.id,
            author_id=people["anika"].id,
            body="Draft policy is in the infra note. Needs a second look before we apply it.",
        )
    )

    db.add(
        ProjectNote(
            project_id=project.id,
            author_id=admin.id,
            title="Sandbox cutover",
            body="Sales wants the sandbox to stay available through the end of the month. Hold production deployment until the 200 PO run is signed off and the shipper bug stays closed.",
        )
    )
    db.add(
        ProjectNote(
            project_id=project.id,
            author_id=people["meera"].id,
            title="Open questions from sales",
            body="They asked whether repeat orders should copy the previous ship-to address automatically. Leaving that on the repeat-order task until art confirms.",
        )
    )

    deployment = ProjectChecklist(project_id=project.id, title="Deployment checklist", created_by=admin.id)
    uat = ProjectChecklist(project_id=project.id, title="UAT checklist", created_by=people["meera"].id)
    release = ProjectChecklist(project_id=project.id, title="Release checklist", created_by=people["anika"].id)
    db.add_all([deployment, uat, release])
    db.flush()

    def add_items(checklist: ProjectChecklist, rows: list[tuple[str, str | None]]) -> None:
        for index, (title, who) in enumerate(rows):
            item = ChecklistItem(checklist_id=checklist.id, title=title, position=index, is_done=who is not None)
            if who:
                item.completed_by = people[who].id
                item.completed_at = utcnow() - timedelta(days=1)
            db.add(item)

    add_items(
        deployment,
        [
            ("Database migration reviewed", "arjun"),
            ("App host health check is green", "anika"),
            ("Rollback steps written down", None),
            ("Sandbox pointed at the new build", None),
        ],
    )
    add_items(
        uat,
        [
            ("200 purchase orders loaded", None),
            ("Art mailbox cases checked", "meera"),
            ("Sales signed off on dropdowns", None),
            ("Excel export opened in the current template", "rohan"),
        ],
    )
    add_items(
        release,
        [
            ("Release notes drafted", "meera"),
            ("Known bugs listed for support", None),
            ("Document links verified", None),
        ],
    )

    log_activity(db, actor=admin, action="project.created", summary=f"{admin.name} created {project.name}", project_id=project.id)
    log_activity(
        db,
        actor=people["rohan"],
        action="task.status",
        summary="Rohan Mehta moved “CSV and Excel export for the order list” to In progress",
        project_id=project.id,
        task_id=created["CSV and Excel export for the order list"].id,
    )
    log_activity(
        db,
        actor=people["anika"],
        action="comment.created",
        summary="Anika Patel commented on “Confirm the S3 bucket policy”",
        project_id=project.id,
        task_id=bucket.id,
    )
    db.commit()
    return {"created": True, "project_id": str(project.id)}
