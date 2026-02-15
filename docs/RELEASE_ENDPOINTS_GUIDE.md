# Release Endpoints Guide

This guide covers:
- `GET /release/status`
- `GET /release/notes`
- `POST /release/deploy`

Base URL: `http://127.0.0.1:4445`

---

## Why these endpoints exist

Deploy-state drift is common when source changes but runtime is not restarted yet. These endpoints make deploy state visible and provide a repeatable release-note flow.

---

## 1) Check deploy/code sync status

### Endpoint
`GET /release/status`

### Command

```bash
curl -s http://127.0.0.1:4445/release/status
```

### What to look for
- `stale` (boolean)
- `reasons` (why runtime/source mismatch exists)
- `startup` snapshot (commit/branch/dirty when process started)
- `current` snapshot (current repo state)
- `lastDeploy` marker (if present)

### Example (stale)

```json
{
  "stale": true,
  "reasons": ["commit changed since server start"],
  "startup": {"commit": "abc123", "branch": "main", "dirty": false},
  "current": {"commit": "def456", "branch": "main", "dirty": false}
}
```

---

## 2) Generate release notes

### Endpoint
`GET /release/notes`

### Commands

Default window (since last deploy marker or fallback window):

```bash
curl -s http://127.0.0.1:4445/release/notes
```

With explicit window + cap:

```bash
SINCE=$(date -v-1d +%s000)  # macOS: last 24h in ms
curl -s "http://127.0.0.1:4445/release/notes?since=${SINCE}&limit=50"
```

### Output includes
- `mergedTasks` list (completed tasks in window)
- `endpointChanges` (inferred from task text)
- `markdown` release-note body

---

## 3) Mark deploy event

### Endpoint
`POST /release/deploy`

### Command

```bash
curl -s -X POST http://127.0.0.1:4445/release/deploy \
  -H 'Content-Type: application/json' \
  -d '{"deployedBy":"echo","note":"deploy after docs PR merge"}'
```

Use this after successful restart/verification to anchor future release-note windows.

---

## Suggested deploy workflow

1. Confirm PR merged and runtime restarted.
2. Run `GET /release/status` and verify mismatch reason is cleared.
3. Run `GET /release/notes` and capture markdown.
4. Post release summary to team channel.
5. Call `POST /release/deploy` to mark checkpoint.

---

## Failure modes and fixes

### `stale=true` after merge
- Runtime likely not restarted on latest commit.
- Re-run deploy path and verify startup/current commit match.

### Missing release note items
- Task status may not be `done` yet.
- Ensure closures and metadata are complete before note generation.

### Empty `lastDeploy`
- No marker written yet; set one with `POST /release/deploy`.

---

## Verification checklist

- [ ] `/release/status` returns expected commit state
- [ ] `/release/notes` includes recent completed tasks
- [ ] `markdown` output is usable without manual rewrite
- [ ] deploy marker set after release
