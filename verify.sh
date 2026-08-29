#!/usr/bin/env bash
# verify.sh — runnable verification recipe (hermes verify / CI).
# B1: controller unit tests.  B2: regenerate scene (mixed).  B3: compliance.  previews.
set -euo pipefail
cd "$(dirname "$0")"

echo "=== B1 controller tests ==="
(cd controller && npm install --no-audit --no-fund >/dev/null && npm test)

echo "=== B2 generate scene (mixed states) ==="
rm -f scenes/latest.usda
python3 usd_connector/sync_to_usd.py mixed 2>/dev/null

echo "=== B3 compliance ==="
(cd verify && python3 check_compliance.py ../scenes)

echo "=== preview: BEFORE (no lights) ==="
python3 usd_connector/sync_to_usd.py --baseline 2>/dev/null
usdrecord scenes/kitchen_baseline.usda previews/preview_before.png --imageWidth 800 2>/dev/null || echo "before render skipped"

echo "=== preview: AFTER (with status lights, mixed states) ==="
LATEST="scenes/latest.usda"
if [ -f "$LATEST" ]; then
  usdrecord "$LATEST" previews/preview.png --imageWidth 800 2>/dev/null || echo "after render skipped"
else
  echo "no scene to render"
fi
