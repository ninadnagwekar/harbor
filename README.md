# Harbor

Harbor is an internal workspace for projects, tasks, and the people doing the work. An admin invites the team, assigns people to projects, and everyone tracks tasks and bugs on a status board, list, table, or calendar. Each project also keeps notes and checklists.

## Run it on Windows

Docker Desktop has to be running. On your PC:

```powershell
git clone https://github.com/ninadnagwekar/harbor.git D:\Harbor
cd D:\Harbor
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

The script writes a local `.env` and opens Harbor at http://127.0.0.1:8080. Create the admin account on the first visit. `http://127.0.0.1:4178` is only the cloud dev server, not the copy on your PC.

## Run it locally

You need Python 3.12, Node.js 22, and PostgreSQL 16.

```bash
createdb harbor
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
```

Start the API (pick your own database URL and session secret):

```bash
export DATABASE_URL=postgresql+psycopg://harbor@localhost:5432/harbor
export JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
backend/.venv/bin/uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8091
```

Start the interface:

```bash
cd frontend && npm run dev
```

Open the app and create the first admin account. That account can invite teammates. Until SMTP is configured, Harbor shows the activation link so you can copy it.

Load the sample order-entry workspace from an empty Projects page if you want a filled board to click through.

## Email

Invitation and password-reset emails are sent when these are set:

- `SMTP_HOST`
- `SMTP_PORT` (default 587)
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `APP_BASE_URL` (the link in the email)

Without them, an admin copies the link from the team page. Forgot-password still does not reveal whether an account exists.

## Docker

```bash
export POSTGRES_PASSWORD=set-a-password
export JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
docker compose up --build
```

The app listens on port 8080 and serves the API and the built interface together.

## Tests

```bash
export TEST_DATABASE_URL=postgresql+psycopg://harbor@localhost:5432/harbor_test
cd backend && .venv/bin/pytest
```

Use a database that is not the one you are developing against. The tests wipe it.

## Roles

Admins invite people, change roles, deactivate accounts, and create or archive projects. Team members only see projects they belong to. Inside those projects they can update tasks, comment, attach files, and keep notes and checklists.
