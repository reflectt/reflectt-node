# task-1776815741074-9km7q9t6h — Agent Detail Pane Truth Spec

**Status:** Draft for @link review → Pixel design handoff
**Author:** @claude
**Reviewer:** @link
**Date:** 2026-04-21
**Unblocked by:** Seam 1 + Seam 2 + Seam 3 verification lane closed

---

## Why this spec exists

Kai's bar: a single pane scan must make any source-of-truth mismatch instantly
visible, so seams like the alias-loss never require cross-endpoint hunting again.

The Seam 3 alias-loss bug took half a day to find because operators had to read
TEAM-ROLES.yaml, `/agents`, `/agent-configs`, mention-ack metrics, and live chat
side by side and notice that `apex.aliases` said `["main", "apex"]` but
`/health/mention-ack/main` was non-zero. Had a single pane shown a "mismatch"
badge on the alias row, the seam would have been obvious in seconds.

This spec defines the shape of the pane, what data feeds each row, and which
endpoints exist today vs. need to be built — split cleanly across cloud, node,
and canvas lanes.

---

## Pane shape — one row per truth field, four columns

Every field in the detail pane is a row with the same four columns, regardless
of whether it's identity, capability, memory, or runtime state.

| Column            | Purpose                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `value`           | Current value as observed from the source                                                                |
| `source`          | The authoritative source label (see "Source markers" below)                                              |
| `kind`            | `persisted` (durable across restarts) or `runtime-only` (in-memory, dies with the process)               |
| `freshness`       | `lastUpdatedAt` for persisted fields; `lastHeartbeatAt` for runtime fields. Empty if N/A.                |
| `badge` (derived) | `mismatch` when two sources for the same logical field disagree; `stale` when freshness exceeds SLA      |

The pane reads top-to-bottom in this order. A row's badge is computed at
read-time by the cloud proxy (not stored), so a future schema change cannot
silently drop the mismatch detector.

### Source markers (controlled vocabulary)

| Marker                  | What it points at                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `TEAM-ROLES.yaml`       | The host's persisted role registry (name, role, aliases, color, voice, affinityTags, wipCap)            |
| `agent_config table`    | SQLite-backed per-agent settings (model, voice override, cost caps, identity claim payload)             |
| `identity claim`        | The most recent `POST /agents/:name/identity/claim` payload, persisted into `agent_config`              |
| `workspace memory file` | The agent's `memory/YYYY-MM-DD.md` daily file under the agent workspace                                  |
| `SOUL.md` / `HEARTBEAT.md` | Pointer + mtime to the agent's per-process markdown surfaces                                          |
| `runtime`               | Live in-memory state owned by the node process (mention-ack pending, current spend, current WIP, etc.)  |
| `capability registry`   | The `/capabilities` + `/capabilities/readiness` derived view                                            |

Kai + Ryan + link aligned that "memory history" reads from agent workspace
`memory/YYYY-MM-DD.md` files, **not** an abstract memory layer. The pane uses
the literal source marker `workspace memory file`. Phase 1 acceptable wording in
copy: "memory history" / "workspace memory" / "daily memory files". Higher-level
summaries are deferred until explicitly asked for.

---

## Field map — what's exposed today vs. what's missing

This is the per-row truth map. "Today" means an endpoint already returns it
(directly or after trivial join). "Missing" means a new node endpoint, cloud
proxy join, or both.

### Identity block

| Field           | Today                                      | Source markers                               | Notes                                                       |
| --------------- | ------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------- |
| name            | `GET /agents` → `agents[].name`            | `TEAM-ROLES.yaml`                            | Canonical id, lowercase                                     |
| displayName     | `GET /agents` → `agents[].displayName`     | `TEAM-ROLES.yaml`                            |                                                             |
| role            | `GET /agents` → `agents[].role`            | `TEAM-ROLES.yaml`                            |                                                             |
| aliases         | `GET /agents` → `agents[].aliases[]`       | `TEAM-ROLES.yaml`                            | Pane shows literal list; mismatch badge when alias resolution differs from this list (the Seam 3 detector) |
| color           | `GET /agents` → `agents[].color`           | `TEAM-ROLES.yaml` + `identity claim`         | Two sources — show both, badge mismatch if different        |
| voice           | `GET /agents` → `agents[].voice`           | `TEAM-ROLES.yaml` + `identity claim`         | Always called "voice" in the pane. Never `kokoro` / engine names |
| affinityTags    | `GET /agents` → `agents[].affinityTags[]`  | `TEAM-ROLES.yaml`                            |                                                             |
| wipCap          | `GET /agents` → `agents[].wipCap`          | `TEAM-ROLES.yaml`                            |                                                             |
| identityClaimedAt | **MISSING** — claim payload is persisted but `claimedAt` not surfaced | `identity claim`        | New: include `claimedAt` in `agent_config` read payload      |

### Runtime block

| Field             | Today                                                       | Source markers          | Notes                                                                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| wipCount / overCap | `GET /agents` → enriched fields                            | `runtime`               | Computed from doing-task count                                        |
| dailySpend         | `GET /agents/:agentId/spend`                               | `runtime`               |                                                                       |
| monthlySpend       | `GET /agents/:agentId/spend`                               | `runtime`               |                                                                       |
| costCapStatus      | `POST /agents/:agentId/enforce-cost`                       | `agent_config table`    | The cap is persisted; the check is runtime — pane row shows both     |
| pendingMentionAcks | `GET /health/mention-ack` (global) — **NEEDS per-agent slice** | `runtime`               | New: `GET /health/mention-ack/:agent` returning pending count + recent acks. The Seam 3 mismatch-detector for this row diffs canonical-vs-alias keys |
| lastHeartbeatAt    | `GET /heartbeat/:agent` exists but pane needs an explicit `lastObservedAt` | `runtime`               | Add `lastObservedAt` to heartbeat payload                              |

### Workspace memory block — pointer + mtime + lazy load

The pane never inlines memory file contents in the join payload. It shows one
row per recent daily memory file as `{ path, mtime, sizeBytes }` and the
canvas-side click triggers a lazy `GET` for the file body.

| Field             | Today                                  | Source markers          | Notes                                                                       |
| ----------------- | -------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| recentMemoryDays  | **MISSING** — `/shared/list` exists but no per-agent memory listing endpoint | `workspace memory file` | New: `GET /agents/:name/memory` returning `[ { date, path, mtime, sizeBytes } ]` for the last N days |
| memoryFileBody    | **MISSING** — `/shared/read` exists but is generic                          | `workspace memory file` | New: `GET /agents/:name/memory/:date` lazy-loads one day's file. Reuses `/shared/read` size cap + extension allowlist |

### SOUL / HEARTBEAT pointer block

| Field     | Today                              | Source markers     | Notes                                                                           |
| --------- | ---------------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| soul      | partial — file exists in workspace | `SOUL.md`          | New: `GET /agents/:name/soul` returning `{ path, mtime, sizeBytes }`. Body lazy-loaded via the same shared-read shape |
| heartbeat | `GET /heartbeat/:agent`            | `HEARTBEAT.md`     | Pane row shows both pointer (file mtime) and live payload (last poll)            |

### Capability block — split per axis

A single `connected/disconnected` value collapses three things that operators
need separated. The pane shows one row per (capability × axis) so the source of
a "this capability isn't working" can be pinpointed without follow-up.

| Axis                | What it answers                                     | Source marker                       |
| ------------------- | --------------------------------------------------- | ----------------------------------- |
| `connected`         | Is the underlying provider/integration reachable?   | `capability registry` (readiness)    |
| `enabledForHost`    | Is the capability turned on at the host/team level? | `capability registry` + host config  |
| `enabledForAgent`   | Is the capability turned on for this specific agent? | `agent_config table`                 |

Each axis row has the same four columns (value/source/kind/freshness/badge).
A capability "connected: true, enabledForHost: true, enabledForAgent: false"
makes the gap obvious without requiring a second tab.

Today: `GET /capabilities` and `GET /capabilities/readiness` cover `connected`
and `enabledForHost`. **Missing:** `enabledForAgent` requires extending
`agent_config` with a per-capability allowlist/denylist surface.

---

## Endpoint shape — pointers + mtime + lazy load

The pane fetches a top-level join in one call, then lazy-loads file bodies on
demand. Inline composites (returning every memory file's content in the join)
are explicitly rejected — they balloon payload size and defeat the freshness
column (which needs file mtime, not a snapshot of contents).

### Top-level join (cloud proxy)

```
GET https://reflectt.ai/api/hosts/:hostId/agents/:name/detail
  → 200 {
      identity: { rows: [ { field, value, source, kind, freshness, badge? }, … ] },
      runtime: { rows: [ … ] },
      memory: { rows: [ { date, path, mtime, sizeBytes, source: "workspace memory file" } ] },
      pointers: {
        soul: { path, mtime, sizeBytes },
        heartbeat: { path, mtime, sizeBytes }
      },
      capabilities: { rows: [ { capability, axis, value, source, kind, freshness, badge? } ] }
    }
```

The cloud proxy fans out to the node behind it, joins, computes mismatch and
stale badges, and returns one payload to canvas.

### Lazy-load endpoints (cloud proxy)

```
GET /api/hosts/:hostId/agents/:name/memory/:date    → file body (size-capped)
GET /api/hosts/:hostId/agents/:name/soul            → file body (size-capped)
```

### Underlying node endpoints — PRIVATE behind cloud proxy

The cloud proxy is the only authorized caller. Node endpoints must not be
exposed directly; canvas never sees a node URL. Reaffirms the standing rule
that node/gateway URLs are not surfaced in the UI.

```
GET /agents/:name/detail                         (NEW — top-level join)
GET /agents/:name/memory                         (NEW — daily file index)
GET /agents/:name/memory/:date                   (NEW — one day's body, size-capped)
GET /agents/:name/soul                           (NEW — soul pointer + body, size-capped)
GET /health/mention-ack/:agent                   (NEW — per-agent pending + recent acks)
```

Each new node endpoint enforces the existing shared-read invariants where
applicable: extension allowlist, size cap, no path traversal, realpath
containment under the agent workspace root.

---

## Mismatch detection — the one-scan-truth requirement

The mismatch badge is computed by the cloud proxy at read time, not persisted.
Detection rules (Phase 1):

| Mismatch                                            | Detector                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| alias-resolution disagreement (the Seam 3 detector) | If any `pendingMentionAcks` keyed entry's agent is not the canonical `name` after `aliases[]` resolution, badge the `aliases` row + the `pendingMentionAcks` row |
| color disagreement                                  | If `TEAM-ROLES.yaml.color !== identity claim.color`, badge the `color` row  |
| voice disagreement                                  | If `TEAM-ROLES.yaml.voice !== identity claim.voice`, badge the `voice` row  |
| capability axis gap                                 | If `connected: true` but `enabledForHost: false` or `enabledForAgent: false`, soft-badge the capability row (informational, not error) |
| stale heartbeat                                     | If `runtime.lastObservedAt` exceeds 2× the heartbeat interval, badge `stale` |

Future detectors land here as new seams are discovered. Each detector is
independent and additive.

---

## Edit / lifecycle controls — phased, out of scope for Phase 1

The pane is read-only for Phase 1. The intent is "make truth visible first;
make it editable second." Documenting the phasing so Pixel can reserve layout
affordances:

- **Phase 1 (this spec):** read-only truth pane, mismatch + stale badges,
  pointer + lazy-load for files. Shipped behind the cloud proxy.
- **Phase 2:** capability toggle controls (per-agent enable/disable) — writes
  through cloud proxy → node → `agent_config table`.
- **Phase 3:** identity edit (color, voice, displayName) — writes go to
  `identity claim` and propagate to `TEAM-ROLES.yaml` via the existing claim flow.
- **Phase 4:** lifecycle controls (pause/retire/restart for managed hosts).

---

## Implementation split — cloud / node / canvas lanes

| Lane    | Owner | Phase 1 deliverables                                                                                              |
| ------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| node    | link  | New endpoints listed above (`/agents/:name/detail`, `/agents/:name/memory[/​:date]`, `/agents/:name/soul`, `/health/mention-ack/:agent`). Reuse shared-read invariants. Add `lastObservedAt` to heartbeat payload. Add `claimedAt` to `agent_config` read payload. |
| cloud   | kai   | Cloud proxy join endpoint (`/api/hosts/:hostId/agents/:name/detail`) that fans out to node, computes mismatch + stale badges, and returns the unified row payload. Lazy-load proxies for memory + soul file bodies. Reaffirm node URLs stay private. |
| canvas  | pixel | Detail pane UI: 4-column rows, badge styling, lazy-load on memory/soul row click. Capability axis split. "Voice" wording everywhere — never engine names. Layout affordances reserved for Phase 2+ controls. |

---

## Wording rules (apply to copy + tooltips)

- "voice" or "speech voice" — **never** `kokoro` or other engine names. Internal
  log messages may say "TTS voice" but agent-facing pane copy must not.
- "memory history" / "workspace memory" / "daily memory files" — never "memory
  layer" or other abstractions.
- Source marker labels are the controlled vocabulary above. Pane copy must use
  them verbatim, not paraphrase.

---

## Acceptance criteria (for this spec, not the impl)

The original task done_criteria, mapped to sections of this doc:

- ✅ Lists which agent-detail fields exist today vs. need new cloud/node endpoints — see "Field map"
- ✅ Covers unified pane shape with source-of-truth markers and phased edit/lifecycle/capability controls — see "Pane shape" + "Edit / lifecycle controls"
- ✅ Gives clean implementation split for cloud, node, canvas lanes — see "Implementation split"

Plus kai's review asks (msg-1776817764151, msg-1776817873683):

- ✅ Per-field columns: value / source / persisted-vs-runtime / freshness / mismatch badge
- ✅ Memory source-of-truth = workspace `memory/YYYY-MM-DD.md` files, marker "workspace memory file"
- ✅ Capability split per axis (connected / enabledForHost / enabledForAgent)
- ✅ Pointers + mtime + lazy-load, no inline composites
- ✅ Node endpoints private behind cloud proxy
- ✅ "Voice" wording rule, no engine names

---

## Handoff

Once link approves, this spec becomes Pixel's design lane input. Phase 1 build
order: node endpoints → cloud proxy join → canvas pane. Each lane can land
independently behind a feature flag; the pane is dark until all three are live.
