#!/usr/bin/env bash
# start.sh — start the full demo in one command
# Usage:
#       ./start.sh            # run in background, logs in .run/*.log
#       ./start.sh stop       # stop all
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .run

stop() {
  pkill -f "controller/server.js" 2>/dev/null || true
  pkill -f "web/dashboard.js" 2>/dev/null || true
  echo "stopped."
  exit 0
}
[ "${1:-}" = "stop" ] && stop

# ensure deps
[ -d controller/node_modules ] || (cd controller && npm install --no-audit --no-fund >/dev/null)
[ -d web/node_modules ] || (cd web && npm install --no-audit --no-fund >/dev/null)

# controller :3000
(PORT=3000 node controller/server.js > .run/controller.log 2>&1 &)
# dashboard :8080
(DASHBOARD_PORT=8080 node web/dashboard.js > .run/dashboard.log 2>&1 &)

sleep 2
echo "=== demo is running ==="
echo "Web UI : http://localhost:8080"
echo "API    : http://localhost:3000/sensors"
echo "Logs   : .run/controller.log  .run/dashboard.log"
echo "Stop   : ./start.sh stop"
