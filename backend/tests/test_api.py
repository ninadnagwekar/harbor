from datetime import timedelta
from uuid import UUID

from app.database import SessionLocal
from app.models import ActivityLog, Invitation, User
from app.services import utcnow
from tests.conftest import HDR, auth


def test_setup_is_once(client):
    auth(client)
    again = client.post(
        "/api/auth/setup",
        json={"name": "Other", "email": "other@harbor.example", "password": "harbor123"},
        headers=HDR,
    )
    assert again.status_code == 403
    status = client.get("/api/auth/status")
    assert status.json()["needs_setup"] is False


def test_login_logout_and_wrong_password(client):
    auth(client)
    client.post("/api/auth/logout", headers=HDR)
    bad = client.post(
        "/api/auth/login",
        json={"email": "ada@harbor.example", "password": "nope1234"},
        headers=HDR,
    )
    assert bad.status_code == 401
    good = client.post(
        "/api/auth/login",
        json={"email": "ada@harbor.example", "password": "harbor123"},
        headers=HDR,
    )
    assert good.status_code == 200
    me = client.get("/api/auth/me")
    assert me.json()["role"] == "admin"
    assert "password" not in me.text


def test_csrf_header_required(client):
    blocked = client.post(
        "/api/auth/login",
        json={"email": "ada@harbor.example", "password": "harbor123"},
    )
    assert blocked.status_code == 403


def test_member_cannot_see_unassigned_project_or_invite(client):
    auth(client)
    created = client.post(
        "/api/projects",
        json={"name": "Private rollout", "description": "Admin only", "status": "planning", "priority": "high"},
        headers=HDR,
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]

    invited = client.post(
        "/api/team/invite",
        json={"email": "sam@harbor.example", "role": "member", "name": "Sam Iqbal"},
        headers=HDR,
    )
    assert invited.status_code == 200, invited.text
    assert invited.json()["delivery"] == "link"
    token = invited.json()["url"].rstrip("/").split("/")[-1]

    member = client.__class__(client.app)
    accepted = member.post(
        "/api/auth/accept",
        json={"token": token, "name": "Sam Iqbal", "password": "member123"},
        headers=HDR,
    )
    assert accepted.status_code == 200, accepted.text
    hidden = member.get(f"/api/projects/{project_id}")
    assert hidden.status_code == 404
    forbidden = member.post(
        "/api/team/invite",
        json={"email": "new@harbor.example", "role": "member"},
        headers=HDR,
    )
    assert forbidden.status_code == 403
    cannot_delete = member.delete(f"/api/projects/{project_id}", headers=HDR)
    assert cannot_delete.status_code == 403

    added = client.patch(f"/api/projects/{project_id}", json={"member_ids": [accepted.json()["id"]]}, headers=HDR)
    assert added.status_code == 200, added.text
    visible = member.get(f"/api/projects/{project_id}")
    assert visible.status_code == 200

    task = member.post(
        f"/api/projects/{project_id}/tasks",
        json={"title": "Write the rollback note", "task_type": "task", "status": "todo", "priority": "medium"},
        headers=HDR,
    )
    assert task.status_code == 200, task.text
    task_id = task.json()["id"]

    outsider = client.__class__(client.app)
    auth_other = None
    # A second admin is not created. Outsider has no session.
    missing = outsider.get(f"/api/tasks/{task_id}")
    assert missing.status_code == 401
    assert auth_other is None

    comment = client.post(
        f"/api/tasks/{task_id}/comments",
        json={"body": "I will take the first pass."},
        headers=HDR,
    )
    assert comment.status_code == 200, comment.text
    notes = member.get("/api/notifications")
    # Comment notifies the creator, who is the member, so the admin comment notifies the member.
    assert notes.status_code == 200
    assert any(item["kind"] == "comment" for item in notes.json()["items"])


def test_expired_invitation_and_deactivated_login(client):
    auth(client)
    invited = client.post("/api/team/invite", json={"email": "nina@harbor.example", "role": "member"}, headers=HDR)
    token = invited.json()["url"].rstrip("/").split("/")[-1]
    db = SessionLocal()
    try:
        row = db.query(Invitation).filter(Invitation.email == "nina@harbor.example").one()
        row.expires_at = utcnow() - timedelta(hours=1)
        db.commit()
    finally:
        db.close()
    rejected = client.post(
        "/api/auth/accept",
        json={"token": token, "name": "Nina Cole", "password": "member123"},
        headers=HDR,
    )
    assert rejected.status_code == 400

    invited = client.post("/api/team/invite", json={"email": "nina@harbor.example", "role": "member"}, headers=HDR)
    token = invited.json()["url"].rstrip("/").split("/")[-1]
    member = client.__class__(client.app)
    accepted = member.post(
        "/api/auth/accept",
        json={"token": token, "name": "Nina Cole", "password": "member123"},
        headers=HDR,
    )
    assert accepted.status_code == 200, accepted.text
    user_id = accepted.json()["id"]
    deactivated = client.patch(f"/api/team/{user_id}", json={"status": "deactivated"}, headers=HDR)
    assert deactivated.status_code == 200
    member.post("/api/auth/logout", headers=HDR)
    blocked = member.post(
        "/api/auth/login",
        json={"email": "nina@harbor.example", "password": "member123"},
        headers=HDR,
    )
    assert blocked.status_code == 403


def test_task_updates_overdue_checklist_and_reset(client):
    auth(client)
    project = client.post(
        "/api/projects",
        json={"name": "Billing cleanup", "status": "in_progress", "priority": "medium"},
        headers=HDR,
    ).json()
    task = client.post(
        f"/api/projects/{project['id']}/tasks",
        json={
            "title": "Fix the tax rounding",
            "task_type": "bug",
            "status": "in_progress",
            "priority": "high",
            "severity": "major",
            "due_date": "2020-01-01",
            "steps_to_reproduce": "Open an invoice with a fractional tax line.",
            "expected_result": "Tax rounds to the nearest cent.",
            "actual_result": "The total is short by one cent.",
        },
        headers=HDR,
    )
    assert task.status_code == 200, task.text
    assert task.json()["overdue"] is True
    assert task.json()["task_type"] == "bug"

    moved = client.patch(f"/api/tasks/{task.json()['id']}", json={"status": "done"}, headers=HDR)
    assert moved.status_code == 200
    assert moved.json()["overdue"] is False

    bulk = client.post(
        "/api/tasks/bulk",
        json={"ids": [task.json()["id"]], "status": "in_review"},
        headers=HDR,
    )
    assert bulk.status_code == 200
    assert bulk.json()[0]["status"] == "in_review"

    checklist = client.post(
        f"/api/projects/{project['id']}/checklists",
        json={"title": "Release checklist"},
        headers=HDR,
    )
    assert checklist.status_code == 200, checklist.text
    updated = client.post(
        f"/api/checklists/{checklist.json()['id']}/items",
        json={"title": "Notes are published"},
        headers=HDR,
    )
    item_id = updated.json()["items"][0]["id"]
    done = client.patch(f"/api/checklist-items/{item_id}", json={"is_done": True}, headers=HDR)
    assert done.json()["progress"] == 100
    assert done.json()["items"][0]["completer"]["name"] == "Ada Loren"

    note = client.post(
        f"/api/projects/{project['id']}/notes",
        json={"title": "Rounding rule", "body": "Round half away from zero for tax lines."},
        headers=HDR,
    )
    assert note.status_code == 200, note.text

    reset = client.post(f"/api/team/{auth_id(client)}/reset-link", headers=HDR)
    # The helper above logged in as the same admin; id is on /me.
    me = client.get("/api/auth/me").json()
    reset = client.post(f"/api/team/{me['id']}/reset-link", headers=HDR)
    assert reset.status_code == 200, reset.text
    token = reset.json()["url"].rstrip("/").split("/")[-1]
    changed = client.post("/api/auth/reset", json={"token": token, "password": "harbor456"}, headers=HDR)
    assert changed.status_code == 200, changed.text
    client.post("/api/auth/logout", headers=HDR)
    relogin = client.post(
        "/api/auth/login",
        json={"email": "ada@harbor.example", "password": "harbor456"},
        headers=HDR,
    )
    assert relogin.status_code == 200


def auth_id(client):
    return client.get("/api/auth/me").json()["id"]


def test_cannot_remove_last_admin(client):
    me = auth(client)
    denied = client.patch(f"/api/team/{me['id']}", json={"role": "member"}, headers=HDR)
    assert denied.status_code == 400
    denied = client.patch(f"/api/team/{me['id']}", json={"status": "deactivated"}, headers=HDR)
    assert denied.status_code == 400


def test_sample_workspace_and_member_scope(client):
    auth(client)
    loaded = client.post("/api/admin/sample-workspace", headers=HDR)
    assert loaded.status_code == 200, loaded.text
    again = client.post("/api/admin/sample-workspace", headers=HDR)
    assert again.json()["created"] is False
    projects = client.get("/api/projects")
    assert any(project["name"] == "GMG Order Entry" for project in projects.json())
    board = client.get("/api/tasks", params={"q": "shipper"})
    assert board.status_code == 200
    assert board.json()[0]["task_type"] == "bug"
    dashboard = client.get("/api/dashboard")
    assert dashboard.status_code == 200, dashboard.text
    counts = dashboard.json()["counts"]
    assert counts["open_bugs"] >= 1
    assert counts["assigned_to_me"] >= 1
    db = SessionLocal()
    try:
        member = db.query(User).filter(User.email == "meera.shah@gmg.example").one()
        assert member.role == "member"
    finally:
        db.close()


def test_test_cases_and_deactivated_activity(client):
    auth(client)
    project = client.post("/api/projects", json={"name": "Quality", "status": "in_progress", "priority": "medium"}, headers=HDR)
    project_id = project.json()["id"]
    exported = client.get(f"/api/projects/{project_id}/test-cases/export")
    assert exported.status_code == 200
    lines = exported.text.splitlines()
    assert lines == [
        "Test Case ID,Title,Module,Priority,Type,Preconditions,Steps,Expected Result,Actual Result,Status,Assigned To,Comments"
    ]
    sheet = (
        "Test Case ID,Title,Module,Priority,Type,Preconditions,Steps,Expected Result,Actual Result,Status,Assigned To,Comments\n"
        ",Sign in,Auth,High,Functional,Account exists,Open the form,The home page loads,,Pass,,\n"
    )
    imported = client.post(
        f"/api/projects/{project_id}/test-cases/import",
        files={"file": ("cases.csv", sheet.encode(), "text/csv")},
        headers=HDR,
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["created"] == 1
    listed = client.get(f"/api/projects/{project_id}/test-cases")
    assert listed.json()[0]["code"] == "TC-001"
    assert listed.json()[0]["title"] == "Sign in"
    assert listed.json()[0]["status"] == "pass"
    assert listed.json()[0]["case_type"] == "functional"

    invited = client.post("/api/team/invite", json={"email": "nina@harbor.example", "role": "member"}, headers=HDR)
    token = invited.json()["url"].rstrip("/").split("/")[-1]
    member = client.__class__(client.app)
    accepted = member.post(
        "/api/auth/accept",
        json={"token": token, "name": "Nina Cole", "password": "member123"},
        headers=HDR,
    )
    assert accepted.status_code == 200, accepted.text
    user_id = accepted.json()["id"]
    added = client.patch(f"/api/projects/{project_id}", json={"member_ids": [user_id]}, headers=HDR)
    assert added.status_code == 200, added.text
    task = member.post(
        f"/api/projects/{project_id}/tasks",
        json={"title": "Retest sign in", "task_type": "task", "status": "todo", "priority": "medium"},
        headers=HDR,
    )
    assert task.status_code == 200, task.text
    before = client.get("/api/activity")
    assert any("Nina Cole" in item["summary"] for item in before.json())
    deactivated = client.patch(f"/api/team/{user_id}", json={"status": "deactivated"}, headers=HDR)
    assert deactivated.status_code == 200, deactivated.text
    after = client.get("/api/activity")
    assert all("Nina Cole" not in item["summary"] for item in after.json())
    db = SessionLocal()
    try:
        leftover = db.query(ActivityLog).filter(ActivityLog.actor_id == UUID(user_id)).count()
        assert leftover == 0
    finally:
        db.close()
