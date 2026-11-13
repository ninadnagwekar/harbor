#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -x backend/.venv/bin/python ]; then
  PY=backend/.venv/bin/python
else
  PY=python3
fi
exec "$PY" -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port "${PORT:-8080}"
