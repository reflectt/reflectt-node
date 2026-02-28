# Pause & Resume Controls

Stop and restart agent task pulls without shutting down reflectt-node.

## Dashboard

Click the **⏸️ Pause** button in the header bar. When paused:
- The button changes to **▶️ Resume**
- A yellow banner shows who paused and why
- Agents calling `/tasks/next` or `/heartbeat/:agent` receive a paused response
- No new tasks are claimed until resumed

Click **▶️ Resume** (header button or banner) to restore normal operation.

## API

### Pause the team
```bash
curl -X POST http://127.0.0.1:4445/pause \
  -H "Content-Type: application/json" \
  -d '{"target": "team", "pausedBy": "ryan", "reason": "Deploying v2.1"}'
```

### Pause with a timer (auto-resume after N minutes)
```bash
curl -X POST http://127.0.0.1:4445/pause \
  -H "Content-Type: application/json" \
  -d '{"target": "team", "durationMin": 30, "pausedBy": "ryan", "reason": "Maintenance window"}'
```

### Pause a single agent
```bash
curl -X POST http://127.0.0.1:4445/pause \
  -H "Content-Type: application/json" \
  -d '{"target": "link", "pausedBy": "ryan", "reason": "Reviewing PRs"}'
```

### Resume
```bash
# Resume team
curl -X DELETE "http://127.0.0.1:4445/pause?target=team"

# Resume specific agent
curl -X DELETE "http://127.0.0.1:4445/pause?target=link"
```

### Check status
```bash
# All pause entries
curl http://127.0.0.1:4445/pause/status

# Specific agent
curl "http://127.0.0.1:4445/pause/status?agent=link"
```

## How It Works

- `POST /pause` creates a pause entry (team-wide or per-agent)
- `/tasks/next` and `/heartbeat/:agent` check pause status before returning tasks
- Timed pauses auto-expire — no manual resume needed
- Pause state persists across server restarts (stored in DB)
- The dashboard polls `/pause/status` every 30 seconds to stay in sync

## Intensity Controls

Separate from pause, **intensity** controls how aggressively agents pull tasks:

| Preset | Behavior |
|--------|----------|
| 🐢 Low | Fewer pulls, longer delays between tasks |
| ⚡ Normal | Default cadence |
| 🔥 High | Aggressive pulls, shorter cooldowns |

Set via the intensity buttons in the dashboard header, or:
```bash
curl -X PUT http://127.0.0.1:4445/policy/intensity \
  -H "Content-Type: application/json" \
  -d '{"preset": "low"}'
```
