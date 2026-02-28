# task-1772244618703-59j5lashg — Pause/Sleep Controls

## Summary
Per-agent and team-wide pause with auto-resume, dashboard banner, and heartbeat/tasks-next integration.

## API
- `POST /pause` — pause target with reason + duration
- `DELETE /pause?target=<name|team>` — unpause
- `GET /pause/status?agent=<name>` — check status

## Integration Points
- `/tasks/next` refuses pulls when paused
- `/heartbeat/:agent` shows paused status
- Dashboard: amber banner + resume button

## PR
https://github.com/reflectt/reflectt-node/pull/506
