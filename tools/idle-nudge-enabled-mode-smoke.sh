#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:4445}"
OUT_DIR="${2:-./artifacts/idle-nudge}"
TS="$(date +%s)"
RUN_DIR="${OUT_DIR}/run-${TS}"

mkdir -p "$RUN_DIR"

echo "[info] base_url=$BASE_URL"
echo "[info] run_dir=$RUN_DIR"

echo "[step] GET /health/idle-nudge/debug"
curl -sS -m 10 "$BASE_URL/health/idle-nudge/debug" | tee "$RUN_DIR/debug.json"

echo "[step] POST /health/idle-nudge/tick?dryRun=true"
curl -sS -m 10 -X POST "$BASE_URL/health/idle-nudge/tick?dryRun=true" | tee "$RUN_DIR/tick-dryrun.json"

echo "[step] POST /health/idle-nudge/tick"
curl -sS -m 10 -X POST "$BASE_URL/health/idle-nudge/tick" | tee "$RUN_DIR/tick-real.json"

cat > "$RUN_DIR/commands.txt" <<EOF
# Baseline debug
curl -sS -m 10 $BASE_URL/health/idle-nudge/debug

# Dry-run tick (POST)
curl -sS -m 10 -X POST "$BASE_URL/health/idle-nudge/tick?dryRun=true"

# Real tick (POST)
curl -sS -m 10 -X POST "$BASE_URL/health/idle-nudge/tick"
EOF

echo "[done] artifacts written to $RUN_DIR"
