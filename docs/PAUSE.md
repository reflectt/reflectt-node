# Pause Controls

Pause an agent or the entire team. While paused, `/tasks/next` refuses to assign new work and heartbeats show `PAUSED` status. Auto-resumes when the optional duration expires.

## Quick Start

### Pause the whole team for 30 minutes

```bash
curl -X POST http://localhost:4445/pause \
  -H "Content-Type: application/json" \
  -d '{"target": "team", "durationMin": 30, "reason": "Standup meeting", "pausedBy": "ryan"}'
```

### Pause a single agent indefinitely

```bash
curl -X POST http://localhost:4445/pause \
  -H "Content-Type: application/json" \
  -d '{"target": "kale", "reason": "Too fast, needs to slow down", "pausedBy": "jake"}'
```

### Resume

```bash
# Resume the team
curl -X DELETE "http://localhost:4445/pause?target=team"

# Resume a specific agent
curl -X DELETE "http://localhost:4445/pause?target=kale"
```

### Check status

```bash
# All pause entries
curl http://localhost:4445/pause/status

# Specific agent (checks team-wide + agent-specific)
curl "http://localhost:4445/pause/status?agent=kale"
```

## API Reference

### `POST /pause`

Pause an agent or team.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | string | yes | Agent name or `"team"` for team-wide |
| `durationMin` | number | no | Auto-resume after N minutes |
| `pausedUntil` | number | no | Unix timestamp to auto-resume (alternative to durationMin) |
| `reason` | string | no | Human-readable reason (default: "Manual pause") |
| `pausedBy` | string | no | Who triggered the pause |

### `DELETE /pause?target=<name>`

Resume an agent or team. Query parameter `target` is required.

### `GET /pause/status?agent=<name>`

Check pause status. Without `agent`, returns all pause entries. With `agent`, checks team-wide pause first, then agent-specific.

## Behavior

- **Task pulls blocked**: `/tasks/next` returns `{ task: null, paused: true, message: "..." }` when the requested agent or team is paused.
- **Heartbeats show paused**: `/heartbeat/:agent` includes `paused: true` and `pauseMessage` fields. Action shows `PAUSED: <reason>`.
- **Auto-resume**: When `pausedUntil` timestamp passes, the next status check auto-clears the pause.
- **Scope priority**: Team-wide pause takes precedence over agent-specific state. An agent is paused if either team or agent is paused.
- **Persistence**: Pause state is stored in SQLite and survives server restarts.

## Dashboard UI

- **Intensity bar**: The ⏸️ Pause / ▶️ Resume button sits next to the intensity control.
- **Banner**: When paused, a banner appears at the top of the dashboard with the reason and a Resume button.
- Both update every 30 seconds automatically.

## Use Cases

1. **"Slow them down"**: Jake's agents were completing tasks too fast. Pause the team, review what they've done, then resume.
2. **Meeting time**: Pause during standup so agents don't interrupt with task claims.
3. **Debugging**: Pause an agent that's misbehaving while you investigate.
4. **Off-hours**: Pause the team overnight with `durationMin: 480` (8 hours).
