# context_sync Handler Hardening

**Task:** task-1772139947194-6y86vu139
**PR:** reflectt-node #421 (merged)

## Changes
1. **Require payload.agent** — missing → command fails with `payload.agent is required`
2. **Forward computed_at** — use from injection response, fallback to Date.now()
3. **REFLECTT_NODE_PORT** — dedicated env var (default 4445)

## Before/After
- `context_sync {}` → silently synced as hardcoded `link` → NOW: command failed
- `computed_at` was always `Date.now()` → NOW: from injection payload when present
- Used `PORT` env → NOW: `REFLECTT_NODE_PORT` (no collision with web server PORT)
