#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y python3-venv
python3 -m venv .venv
if [ -f requirements.txt ]; then
  .venv/bin/python -m pip install -r requirements.txt
elif [ -f pyproject.toml ]; then
  .venv/bin/python -m pip install -e .
fi
