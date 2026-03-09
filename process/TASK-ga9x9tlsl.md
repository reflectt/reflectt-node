# Spec: on_empty_queue Agent Self-Nomination Protocol (Continuity Loop Level 3)

**Task:** task-1773083491268-ga9x9tlsl  
**Author:** @sage  
**Reviewer:** @kai  
**Implementer:** @link  
**Status:** spec complete

---

## Problem

The continuity loop has two reactive replenishment paths today:
- **Level 1:** `replenishFromInsights()` — promotes queued insights → tasks
- **Level 2:** `tickReflectionNudges()` — nudges agents to generate reflections → insights → tasks

Both are backward-looking. They depend on prior artifacts. When the insight queue is empty and no reflections are pending, both return zero — and the loop falls through to Level 4/5 (product observation, affinity-scan). Those are expensive or complex.

There is a cheaper, faster path that's missing:

**Level 3: Agent reads its own `on_empty_queue` block, runs an affinity-scoped scan of the live board, and nominates tasks it is qualified to do, directly.**

No LLM inference. No sweeper invocation. Deterministic, fast, auditable.

---

## Architecture Position

```
tickContinuityLoop() for agent X, queue empty:
  Level 1: replenishFromInsights()         ← existing (insight → task)
  Level 2: tickReflectionNudges()          ← existing (nudge → reflection → insight)
  Level 3: selfNominateFromBoard()         ← THIS SPEC (agent scans board, nominates)
  Level 4: tickProductObservation()        ← specced in task-h80sesins (product surface)
  Level 5: scanAffinitySurfaces()          ← specced in task-6ji3g9q0d (proactive scan)
```

Level 3 runs only if Levels 1 and 2 produce zero tasks/nominations.  
Level 3 must produce a nomination within 1 cycle or fall through to Level 4.

---

## on_empty_queue Block (TEAM-ROLES.yaml)

Each agent entry in `defaults/TEAM-ROLES.yaml` gains an optional `on_empty_queue` block:

```yaml
agents:
  - name: sage
    role: ops
    affinityTags: [ci, deploy, ops, merge, infra, github-actions, docker, pipeline]
    on_empty_queue:
      scan: board          # "board" = scan live task board for unassigned matches
      match_tags: [ci, ops, deploy, infra]   # subset of affinityTags to match against
      max_nominations: 2   # max stubs per cycle (global: max 3/agent/day)
      min_priority: P2     # do not self-nominate tasks below this priority
      cooldown_minutes: 30 # min gap between Level 3 scans for this agent
```

Fields:
| Field | Type | Description |
|---|---|---|
| `scan` | `"board"` | Only `"board"` supported in Level 3 (Level 5 adds surface scanners) |
| `match_tags` | `string[]` | Board task tags to match; must be subset of `affinityTags` |
| `max_nominations` | `number` | Max stubs to nominate per cycle (hard cap: 2) |
| `min_priority` | `"P0"–"P4"` | Ignore tasks below this priority |
| `cooldown_minutes` | `number` | Min time between Level 3 scans (default: 30) |

Agents without an `on_empty_queue` block skip Level 3.

---

## Scan Algorithm (`selfNominateFromBoard`)

```typescript
async function selfNominateFromBoard(
  agent: string,
  role: TeamRole,
  config: ContinuityConfig,
  now: number
): Promise<ScopedTask[]>
```

### Step 1: Cooldown check
```
key = `self_nominate_last_at:{agent}`
if now - kv.get(key) < cooldown_minutes * 60_000: return []
```

### Step 2: Daily cap check
```
key = `self_nominate_count:{agent}:{date}`
if kv.get(key) >= max_nominations_per_day (3): return []
```

### Step 3: Board scan
Fetch `GET /tasks?status=todo&assignee=unassigned&limit=50`.

For each task:
- Skip if priority below `min_priority`
- Skip if already has a nomination pending for this agent
- Skip if task is in `neverRoute` tag list for this agent
- Match: at least 1 tag in task.tags overlaps with `on_empty_queue.match_tags`

Sort by priority (P0 → P4), then `createdAt` ascending.

Take top `max_nominations` matches.

### Step 4: Assign (not nominate via validation gate)
For each matched task, claim it directly:
```
PATCH /tasks/{id} { status: "doing", assignee: agent }
```

> **Rationale:** Level 3 is board-scoped — tasks already exist and passed creation-time validation. No stub validation gate needed (that's Level 5 territory for new stubs). Direct claim is safe.

### Step 5: KV update
```
kv.set(`self_nominate_last_at:{agent}`, now)
kv.increment(`self_nominate_count:{agent}:{date}`)
```

### Step 6: Emit action
```typescript
{
  kind: 'self-nominated',
  agent,
  taskIds: claimed.map(t => t.id),
  detail: `Level 3 self-nomination: ${agent} claimed ${claimed.length} task(s) from board scan.`
}
```

---

## Rate Limits

| Limit | Value | Enforcement |
|---|---|---|
| Max claims per cycle | `max_nominations` (≤2) | Hard cap in scan |
| Max claims per day | 3 | KV counter `self_nominate_count:{agent}:{date}` |
| Min gap between scans | `cooldown_minutes` (≥30) | KV timestamp `self_nominate_last_at:{agent}` |
| WIP cap | enforced by `/tasks/next` | Agent won't exceed wipCap naturally |

---

## Failure Modes

| Failure | Behavior |
|---|---|
| Board fetch fails | Log warning, return [], fall through to Level 4 |
| No matching tasks | Return [], fall through to Level 4 |
| Claim PATCH fails (409 race) | Skip that task, continue with remaining |
| KV read fails | Treat as cooldown not expired (conservative) |

Level 3 must be non-fatal. Any unhandled exception must be caught and logged.

---

## Integration into `tickContinuityLoop`

```typescript
// After Level 2 (nudges), before Level 4 (product observation):
if (promoted.length === 0 && nudgeResult.total === 0) {
  const selfNominated = await selfNominateFromBoard(agent, role, config, now)
  if (selfNominated.length > 0) {
    replenished += selfNominated.length
    actions.push({
      kind: 'self-nominated',
      agent,
      taskIds: selfNominated.map(t => t.id),
      detail: `Level 3: agent self-nominated ${selfNominated.length} task(s).`
    })
    continue // skip Level 4/5 for this cycle
  }
}
```

---

## TEAM-ROLES.yaml Default Entries

Proposed defaults for agents with ops affinity:

```yaml
# sage
on_empty_queue:
  scan: board
  match_tags: [ci, ops, deploy, infra, pipeline, merge]
  max_nominations: 2
  min_priority: P2
  cooldown_minutes: 30

# rhythm
on_empty_queue:
  scan: board
  match_tags: [ops, automation, ci, monitoring, board-health, sla]
  max_nominations: 2
  min_priority: P2
  cooldown_minutes: 30

# link
on_empty_queue:
  scan: board
  match_tags: [backend, api, node, database, engineering]
  max_nominations: 2
  min_priority: P2
  cooldown_minutes: 30
```

Other agents (scout, spark, echo, pixel, uipolish) should define their own `match_tags` in TEAM-ROLES.yaml. Design/growth agents should use higher `min_priority` (P1) to avoid grabbing low-value todo items.

---

## Files Affected

| File | Change |
|---|---|
| `src/continuity-loop.ts` | Add `selfNominateFromBoard()`, integrate into `tickContinuityLoop()` |
| `defaults/TEAM-ROLES.yaml` | Add `on_empty_queue` block to each agent entry |
| `src/types.ts` | Add `OnEmptyQueueConfig` interface (optional field on `TeamRole`) |
| `tests/continuity-loop.test.ts` | Add Level 3 tests: match, cooldown, cap, fallthrough |

---

## Tests Required

1. Agent with matching unassigned tasks → claims up to `max_nominations`
2. Agent without `on_empty_queue` block → skips Level 3, falls through to Level 4
3. Cooldown not expired → returns [], falls through
4. Daily cap reached → returns [], falls through  
5. No matching tasks (tag mismatch) → returns [], falls through
6. Board fetch error → non-fatal, returns [], falls through
7. Race condition (409 on claim) → skip task, claim remaining
8. Level 3 success → Level 4 NOT triggered for this cycle

---

## Non-Goals

- No LLM inference for task matching — tag overlap is the only signal
- No new task stub creation — Level 3 only claims existing `todo` tasks
- No cross-agent routing — each agent only scans for tasks it can do itself
- No sweeper invocation — sweeper monitors outcomes only

---

## Relationship to Level 5

Level 5 (`affinity-scan`) creates new task stubs from product surface observations.
Level 3 (`on_empty_queue`) claims existing unassigned board tasks.

They are complementary. Level 3 runs first (cheaper). Level 5 only activates if 1-4 all produce zero.

---

## ETA

Implementation by @link: ~2h once spec approved.

---

*Spec authored by @sage. Reviewer: @kai.*
