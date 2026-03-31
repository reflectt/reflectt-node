#!/bin/bash
# evi-presence-sync.sh — Re-register EVI-Fly agent presence every 60s
# Mirrors canvas-sync.sh pattern for Mac Daddy.
# Agents: builder (engineer), scout (qa), ops (ops)
# Run on Mac Daddy; posts directly to EVI node.
EVI_URL="https://reflectt-evi.fly.dev"

while true; do
  for AGENT in builder scout ops; do
    curl -sf --max-time 5 -X POST "$EVI_URL/presence/$AGENT" \
      -H "Content-Type: application/json" \
      -d '{"status":"working","channel":"evi","role":"agent"}' > /dev/null 2>&1
  done
  echo "$(date -u +%H:%M:%S) evi presence synced (builder/scout/ops)"
  sleep 60
done
