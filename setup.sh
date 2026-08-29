#!/usr/bin/env bash
# setup.sh — one-command setup for Linux/macOS
set -euo pipefail
cd "$(dirname "$0")"

# Python deps
python3 - <<'PY'
import sys
print(f"Python {sys.version}")
PY
python3 -m pip install --no-cache-dir usd-core==26.8

# Node deps
(cd controller && npm install --no-audit --no-fund)
(cd web && npm install --no-audit --no-fund)

# Asset
mkdir -p assets
if [ ! -d assets/KitchenSet ]; then
  curl -sL -o assets/Kitchen_set.zip https://openusd.org/files/Kitchen_set.zip
  unzip -o assets/Kitchen_set.zip -d assets/KitchenSet
fi

# Env
cp -f .env.example .env || true

echo "[ok] setup complete. Run: ./start.sh"
