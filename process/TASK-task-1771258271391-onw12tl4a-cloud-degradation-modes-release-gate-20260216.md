# TASK task-1771258271391-onw12tl4a — Explicit degradation modes + cloud outage drill release gate

## Artifact Type
Architecture + release gate spec (implementation-ready)

## 1) Degradation mode contract (single source of truth)

Define `cloud_connectivity_mode` for host/runtime and dashboard:

- `connected`
  - Cloud API + heartbeat + webhook relay healthy.
- `degraded`
  - Cloud unreachable/intermittent OR partial cloud subsystems unavailable.
  - Host remains fully operable for local task execution.
- `offline`
  - Sustained cloud outage beyond threshold.
  - Host runs local-only mode with durable outbound queueing.

### Transition thresholds (proposed)
- `connected -> degraded`: 3 consecutive failed cloud heartbeats or 30s timeout window.
- `degraded -> offline`: 5m sustained inability to reach cloud control endpoints.
- `offline/degraded -> connected`: 2 consecutive successful heartbeats + queue flush success.

## 2) Functional behavior matrix (what breaks vs what keeps working)

### Must keep working during degraded/offline
- Local task CRUD + assignment + execution on host.
- Local watchdog/lane enforcement.
- Local artifacts generation.
- Local API/UI for host operators.

### Degraded behavior
- Cloud dashboards may show stale data badge + last successful sync time.
- Host writes outbound events to local durable queue.
- Retry with exponential backoff + jitter.

### Offline behavior
- No cloud-dependent control actions (provision, cloud-only orchestration).
- All outbound events buffered for replay.
- Explicit operator-visible banner: "Running in local-only mode; cloud sync pending."

## 3) Webhook/event delivery semantics during outage

Implement/standardize:
- Idempotency key per event (`event_id` + `source_host_id`).
- Durable local queue with monotonic enqueue timestamp.
- Retry policy: exp backoff (base 2s, cap 5m, jitter).
- Replay window: minimum 24h retention.
- Dead-letter marking after max retries; manual replay endpoint/UI action.

## 4) Dashboard status model

Expose per-host fields:
- `cloud_connectivity_mode`
- `last_cloud_success_at`
- `queue_depth`
- `oldest_queued_event_age_ms`
- `degraded_reason` (timeout/auth/5xx/network)

Display states:
- Connected ✅
- Degraded ⚠️ (with reason + freshness)
- Offline 🔴 (local-only fallback active)

## 5) CI release gate: cloud outage drill

Add required integration scenario (must pass to release):

1. Start host + cloud in healthy mode.
2. Verify connected mode.
3. Simulate cloud outage (block cloud endpoint / stop service).
4. Verify transition to degraded/offline per thresholds.
5. Execute local task operations; assert success.
6. Emit sync events during outage; assert queue growth.
7. Restore cloud.
8. Verify reconnection, replay, idempotent apply, queue drain.
9. Assert no data loss and no duplicate side effects.

Gate failure conditions:
- Local operations fail while cloud is unavailable.
- Queue data loss.
- Duplicate replay side effects.
- Status model not surfaced in API/dashboard.

## 6) Proposed implementation slices

- Slice A: connectivity state machine + host status fields.
- Slice B: durable outbound queue + retry/replay worker.
- Slice C: dashboard status badges/freshness + queue health.
- Slice D: outage drill integration test + CI gate wiring.
- Slice E: operator docs: "What breaks vs what keeps working".

## 7) Acceptance mapping to task done criteria

- Host local operation during cloud outage: covered in matrix + drill steps.
- Dashboard explicit connected/degraded/offline: covered in status model.
- Webhook buffer + replay: covered in semantics section.
- Outage simulation as CI gate: covered in release gate section.
- Explicit breakage documentation: covered in behavior matrix.
