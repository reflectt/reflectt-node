# Shared Workspace Read API

Read-only access to shared artifacts under the canonical shared workspace (`~/.openclaw/workspace-shared`).

---

## Architecture

```
reflectt-node workspace          shared workspace              other agent workspaces
┌────────────────────┐          ┌──────────────────────┐      ┌──────────────────────┐
│ process/            │  mirror  │ process/              │ read │                      │
│   TASK-xxx-spec.md  │ ──────→ │   TASK-xxx-spec.md    │ ←──  │ (via /shared/* API)  │
│   TASK-yyy-proof.md │         │   TASK-yyy-proof.md   │      │                      │
└────────────────────┘          └──────────────────────┘      └──────────────────────┘
       (source)                  (~/.openclaw/workspace-shared)       (consumer)
```

**Artifact mirror** (`src/artifact-mirror.ts`) copies `process/` artifacts from the workspace to the shared workspace on task transitions (→ `validating` or → `done`).

**Shared workspace API** (`src/shared-workspace-api.ts`) provides safe read-only access to files under the shared workspace.

**Task artifact resolution** (`resolveTaskArtifact()`) tries the workspace root first, then falls back to the shared workspace — so reviewers in other workspaces can access artifacts without manual copying.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REFLECTT_SHARED_WORKSPACE` | `~/.openclaw/workspace-shared` | Override shared workspace path |
| `REFLECTT_WORKSPACE` | `process.cwd()` | Override workspace root (source for mirror) |

---

## HTTP Endpoints

### `GET /shared/list`

List files in a shared workspace directory.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | query string | `process/` | Relative path (must start with `process/`) |
| `limit` | query number | `200` | Max entries to return (capped at 500) |

**Response:**
```json
{
  "success": true,
  "root": "/Users/me/.openclaw/workspace-shared",
  "path": "process/",
  "entries": [
    { "name": "subdir", "path": "process/subdir", "type": "directory" },
    { "name": "TASK-xxx-spec.md", "path": "process/TASK-xxx-spec.md", "type": "file", "size": 4096, "extension": ".md" }
  ]
}
```

- Directories are sorted before files.
- Files with disallowed extensions are filtered out.

### `GET /shared/read`

Read a file's contents from the shared workspace.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | query string | *required* | Relative file path |
| `include` | query string | — | Set to `preview` for first N characters |
| `maxChars` | query number | `2000` | Max characters when `include=preview` |

**Response:**
```json
{
  "success": true,
  "file": {
    "path": "process/TASK-xxx-spec.md",
    "content": "# Spec\n...",
    "size": 4096,
    "truncated": false,
    "source": "shared-workspace"
  }
}
```

### `GET /shared/view`

HTML viewer for shared artifacts (browser-friendly).

| Param | Type | Description |
|-------|------|-------------|
| `path` | query string | Relative file path |

Returns an HTML page with the file content in a dark-themed code viewer.

### `GET /tasks/:id/artifacts`

Resolve all artifact references for a task. Checks workspace root first, falls back to shared workspace.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `include` | query string | — | `preview` (first 2000 chars) or `content` (full, up to 400KB) |

**Response:**
```json
{
  "taskId": "task-xxx",
  "title": "Feature: ...",
  "status": "validating",
  "artifactCount": 2,
  "artifacts": [
    {
      "source": "metadata.artifact_path",
      "path": "process/TASK-xxx-spec.md",
      "type": "file",
      "accessible": true,
      "source": "shared-workspace",
      "resolvedPath": "/Users/me/.openclaw/workspace-shared/process/TASK-xxx-spec.md",
      "preview": "# Spec\n..."
    },
    {
      "source": "metadata.qa_bundle.review_packet.pr_url",
      "path": "https://github.com/reflectt/reflectt-node/pull/330",
      "type": "url",
      "accessible": true,
      "resolvedPath": "https://github.com/reflectt/reflectt-node/pull/330"
    }
  ],
  "heartbeat": {
    "lastCommentAt": 1771960904685,
    "lastCommentAgeMs": 3600000,
    "lastCommentAuthor": "link",
    "stale": false,
    "thresholdMs": 1800000
  }
}
```

### `GET /artifacts/view`

HTML viewer for workspace-local artifacts (similar to `/shared/view` but resolves against the repo root).

---

## Security Model

### Path Validation (`validatePath()`)

1. **No absolute paths** — rejects `/`, `\`, and Windows drive letters (`C:\`)
2. **No traversal** — rejects any path containing `..` (checked before normalization)
3. **Prefix allowlist** — path must start with `process/` (extensible via `ALLOWED_PREFIXES`)
4. **Containment check** — resolved absolute path must be under the shared workspace root
5. **Extension allowlist** — only `.md`, `.txt`, `.json`, `.log`, `.yml`, `.yaml` are served
6. **Size cap** — files larger than 400KB are rejected

### Traversal Attack Examples (All Rejected)

| Attack | Rejection Reason |
|--------|-----------------|
| `../../etc/passwd` | `..` traversal detected |
| `/etc/passwd` | Absolute path |
| `process/../../etc/passwd` | `..` traversal detected |
| `process/secret.exe` | Extension not in allowlist |
| `src/server.ts` | Not in `process/` prefix |
| `C:\Windows\System32` | Drive letter / absolute path |

### Artifact Resolution Priority

1. **Workspace root** (`REFLECTT_WORKSPACE` / cwd) — checked first
2. **Shared workspace** (`REFLECTT_SHARED_WORKSPACE` / `~/.openclaw/workspace-shared`) — fallback
3. **Missing** — neither location has the file

This means the workspace-local copy always wins, and the shared workspace is used when reviewers don't have the file locally (e.g., different agent workspaces).

---

## Integration with Artifact Mirror

The artifact mirror (`src/artifact-mirror.ts`) is the **write** side. It copies process artifacts to the shared workspace on task state transitions:

```
Task → validating  →  mirrorArtifacts(metadata.artifact_path)
Task → done        →  mirrorArtifacts(metadata.artifact_path)
```

The shared workspace API is the **read** side. Together they form a publish/subscribe pattern:

```
Agent A (author)          Agent B (reviewer)
    │                          │
    ├── writes process/TASK-xxx.md
    ├── task → validating
    ├── artifact mirror → copies to shared workspace
    │                          │
    │                          ├── GET /tasks/:id/artifacts?include=preview
    │                          ├── sees artifact via shared-workspace fallback
    │                          ├── GET /shared/read?path=process/TASK-xxx.md
    │                          └── reviews content
```

---

## Testing

```bash
# Run shared workspace API tests
npx vitest run tests/shared-workspace-api.test.ts

# Run artifact mirror tests
npx vitest run tests/artifact-mirror.test.ts

# Run all tests
npm test --silent
```

Test coverage: 21 tests covering path validation (5 security vectors), extension validation (2 types), list/read (8 scenarios), and artifact resolution (5 scenarios).
