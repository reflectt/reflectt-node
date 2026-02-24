# Shared Workspace Read API

Read-only HTTP endpoints for accessing mirrored artifacts in the shared workspace (`~/.openclaw/workspace-shared`).

## Overview

When a task transitions to `validating` or `done`, the artifact mirror (`src/artifact-mirror.ts`) copies process artifacts from the agent's workspace to `~/.openclaw/workspace-shared/process/`. This shared workspace API provides safe, read-only access for reviewers across workspaces.

## Endpoints

### `GET /shared/list`

List files and directories in the shared workspace.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | `process/` | Relative path under shared workspace root |
| `limit` | number | `200` | Max entries to return (capped at 500) |

**Response:**
```json
{
  "success": true,
  "root": "/Users/you/.openclaw/workspace-shared",
  "path": "process/",
  "entries": [
    { "name": "task-deep", "path": "process/task-deep", "type": "directory" },
    { "name": "task-abc-proof.md", "path": "process/task-abc-proof.md", "type": "file", "size": 1234, "extension": ".md" }
  ]
}
```

### `GET /shared/read`

Read file contents from the shared workspace.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | *required* | Relative path to file |
| `include` | string | — | `preview` for truncated first 2000 chars |
| `maxChars` | number | `2000` | Max chars when `include=preview` |

**Response:**
```json
{
  "success": true,
  "file": {
    "path": "process/task-abc-proof.md",
    "content": "# Proof\n...",
    "size": 1234,
    "truncated": false,
    "source": "shared-workspace"
  }
}
```

### `GET /shared/view`

HTML viewer for shared artifacts (rendered in browser).

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Relative path to file |

### `GET /tasks/:id/artifacts`

Lists all artifact references for a task. **Automatically falls back to the shared workspace** if an artifact is not found in the workspace root.

| Parameter | Type | Description |
|-----------|------|-------------|
| `include` | string | `preview` or `content` to include file contents |

Response artifacts include a `source` field: `"workspace"` or `"shared-workspace"`.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `REFLECTT_SHARED_WORKSPACE` | `~/.openclaw/workspace-shared` | Override shared workspace root |

**Note:** The env var supports `~/` prefix (manually expanded).

## How It Interacts with Artifact Mirror

```
Agent workspace                     Shared workspace
process/task-abc-proof.md  ──copy──> process/task-abc-proof.md
                                         │
                                    GET /shared/read?path=process/task-abc-proof.md
                                    GET /tasks/:id/artifacts (fallback)
```

1. Agent completes task (status → `validating`/`done`)
2. `artifact-mirror.ts` copies `process/` artifacts to shared workspace
3. Reviewers in other workspaces can read via `/shared/*` endpoints
4. `/tasks/:id/artifacts` checks workspace root first, then shared workspace

## Security

### Path validation
- Only relative paths accepted (no absolute, no drive letters)
- `..` segments rejected before and after normalization
- Prefix allowlist: only `process/` paths (extensible)

### Realpath containment (symlink defense)
- Both root and candidate paths resolved via `fs.realpath()`
- Containment verified via `path.relative()` (not string prefix)
- On macOS: handles APFS case-insensitivity and `/var` → `/private/var` canonicalization
- Listing uses `lstat` to detect symlinks; symlinks pointing outside root are silently skipped

### Extension allowlist
`.md`, `.txt`, `.json`, `.log`, `.yml`, `.yaml`

### Size cap
400KB per file read (truncated if exceeded in preview mode, rejected otherwise).

### Why not string prefix checks?
String prefix (`startsWith(root)`) can be fooled by sibling paths (`/allowed-root` vs `/allowed-root-evil`). We use `path.relative()` on `realpath`-resolved paths instead.

### Future: host-credential scoped access
We do **not** attempt to model host-credential scoped access at this layer. Access is gated at the HTTP API level (localhost binding for reflectt-node). If direct Supabase access is ever needed, a host JWT with `host_id`/`team_id` claims would be required.
