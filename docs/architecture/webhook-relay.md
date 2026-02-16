# Webhook Relay Architecture

> Cloud receives inbound webhooks from external services (GitHub, Stripe, Vercel, etc.)
> and forwards them to agent hosts via the existing cloud sync channel.

## Overview

```
  GitHub/Stripe/Vercel
         │
         ▼
  ┌─────────────────┐
  │  reflectt-cloud  │  Public endpoint per host
  │  /webhooks/:id   │  Receives, validates, stores
  └────────┬─────────┘
           │ store-and-forward
           ▼
  ┌─────────────────┐
  │  Delivery Queue  │  Durable storage (Postgres)
  │  + Retry Engine  │  At-least-once semantics
  └────────┬─────────┘
           │ via heartbeat pull or WebSocket push
           ▼
  ┌─────────────────┐
  │  reflectt-node   │  Host receives, processes,
  │  (agent host)    │  acks delivery
  └──────────────────┘
```

## Design Principles

1. **Store-and-forward**: Every inbound webhook is persisted before delivery attempt. No fire-and-forget.
2. **At-least-once delivery**: Hosts must ack. Unacked deliveries retry with backoff.
3. **Idempotency**: Every webhook gets a unique `delivery_id`. Hosts use this to deduplicate.
4. **Audit trail**: Full lifecycle tracking (received → queued → delivered → acked/failed → DLQ).
5. **Host-scoped**: Each host gets its own webhook URL. No cross-host leakage.

## Cloud Side (reflectt-cloud)

### Inbound Endpoint

```
POST /api/webhooks/:hostId/:source
```

- `:hostId` — the registered host ID (from `/api/hosts/claim`)
- `:source` — the webhook source identifier (e.g., `github`, `stripe`, `vercel`)
- Headers and body are captured verbatim

**Validation:**
- Verify host exists and is active
- Rate limit: 100 webhooks/min per host (429 if exceeded)
- Max payload: 1MB
- Return `200 OK` immediately (async processing)

**Signature verification (per-source):**
- GitHub: `x-hub-signature-256` — HMAC-SHA256 with host's configured secret
- Stripe: `stripe-signature` — Stripe's timestamp + signature scheme
- Generic: optional `x-webhook-secret` header match
- Secrets stored per-host in cloud, never transmitted to host

### Storage Schema (Postgres)

```sql
CREATE TABLE webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id         TEXT NOT NULL REFERENCES hosts(id),
  source          TEXT NOT NULL,             -- 'github', 'stripe', etc.
  delivery_id     TEXT NOT NULL UNIQUE,      -- idempotency key
  
  -- Inbound payload
  headers         JSONB NOT NULL,
  body            JSONB,                     -- parsed JSON body
  raw_body        BYTEA,                     -- raw bytes for signature verification
  
  -- Delivery state
  status          TEXT NOT NULL DEFAULT 'queued',
                  -- queued → delivering → delivered → acked
                  --                    → failed → retrying → dlq
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 5,
  next_retry_at   TIMESTAMPTZ,
  last_error      TEXT,
  
  -- Audit
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ,
  acked_at        TIMESTAMPTZ,
  dlq_at          TIMESTAMPTZ,
  
  -- Source metadata
  event_type      TEXT,                      -- e.g., 'pull_request', 'push'
  event_action    TEXT,                      -- e.g., 'opened', 'closed'
  
  INDEX idx_webhook_host_status (host_id, status),
  INDEX idx_webhook_retry (status, next_retry_at)
);
```

### Delivery ID Generation

```
delivery_id = "{source}:{event_id}:{timestamp_ms}"
```

- GitHub: `github:{x-github-delivery}:{received_ms}`
- Stripe: `stripe:{stripe-event-id}:{received_ms}`
- Generic: `{source}:{sha256(body)[:16]}:{received_ms}`

### Retry Strategy

| Attempt | Backoff    | Cumulative |
|---------|-----------|------------|
| 1       | immediate | 0s         |
| 2       | 30s       | 30s        |
| 3       | 2min      | 2.5min     |
| 4       | 10min     | 12.5min    |
| 5       | 1h        | 1h 12.5min |
| DLQ     | —         | after 5    |

After `max_attempts`, move to DLQ status. DLQ items are retained 7 days, surfaced in dashboard.

### Delivery Mechanisms

**Option A: Heartbeat Pull (MVP)**
Host already sends heartbeats every N seconds. Cloud piggybacks pending webhooks:

```json
// POST /api/hosts/heartbeat response
{
  "status": "ok",
  "webhooks": [
    {
      "delivery_id": "github:abc123:1707912345000",
      "source": "github",
      "event_type": "pull_request",
      "event_action": "opened",
      "headers": { "x-github-event": "pull_request" },
      "body": { ... },
      "received_at": "2026-02-16T..."
    }
  ]
}
```

Host processes and acks:
```json
// POST /api/hosts/heartbeat (next heartbeat)
{
  "webhook_acks": ["github:abc123:1707912345000"]
}
```

**Pros:** No new transport, works through NAT/firewalls, minimal cloud complexity.
**Cons:** Delivery latency = heartbeat interval (default 30s). Acceptable for MVP.

**Option B: WebSocket Push (Future)**
If host has an active WebSocket connection (e.g., for real-time dashboard), push immediately:

```json
{ "type": "webhook", "payload": { ... } }
```

Host sends ack frame. Falls back to heartbeat pull if WS disconnects.

### Recommendation: Start with Option A (Heartbeat Pull)

- Zero new infrastructure
- Already proven transport
- Delivery latency (30s max) is fine for CI/deploy webhooks
- Upgrade to WebSocket push later for real-time needs

## Host Side (reflectt-node)

### Webhook Processing Pipeline

```
heartbeat response
    │
    ▼
  Parse webhooks array
    │
    ▼
  Deduplicate (check delivery_id in local ledger)
    │
    ▼
  Route by source:
    ├── github → GitHub webhook handler
    ├── stripe → Stripe webhook handler  
    └── generic → configurable handler
    │
    ▼
  Process (update tasks, trigger events, etc.)
    │
    ▼
  Store delivery_id in local ledger (SQLite)
    │
    ▼
  Queue ack for next heartbeat
```

### Local Delivery Ledger (SQLite)

```sql
CREATE TABLE webhook_ledger (
  delivery_id   TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  event_type    TEXT,
  processed_at  INTEGER NOT NULL,  -- epoch ms
  result        TEXT NOT NULL       -- 'success', 'error', 'skipped'
);
```

Used for:
- Deduplication (at-least-once → effectively-once)
- Audit trail on host side
- Debugging webhook processing issues

### GitHub Handler (First Integration)

Already partially built (PR #118, not yet on main). Extend to:

1. **pull_request events** → match `head.ref` to task branch, update PR metadata
2. **push events** → detect force-push, update task branch status
3. **check_suite / check_run** → CI status updates on tasks
4. **issue_comment** → PR review comments linked to tasks

```typescript
// src/webhooks/github.ts
export function handleGitHubWebhook(
  eventType: string,
  payload: Record<string, unknown>,
  taskManager: TaskManager,
): { processed: boolean; taskId?: string; action?: string } {
  switch (eventType) {
    case 'pull_request':
      return handlePullRequest(payload, taskManager)
    case 'check_suite':
      return handleCheckSuite(payload, taskManager)
    default:
      return { processed: false }
  }
}
```

## Webhook Configuration

Per-host webhook config in `~/.reflectt/config.json`:

```json
{
  "webhooks": {
    "github": {
      "enabled": true,
      "events": ["pull_request", "push", "check_suite"]
    },
    "stripe": {
      "enabled": false
    }
  }
}
```

Cloud uses this to:
- Filter events before queuing (don't store what host won't process)
- Display configured integrations in dashboard

## Security

### Signature Verification (Cloud-Side)

Webhook secrets are stored per-host in cloud. Cloud verifies signatures on inbound
webhooks BEFORE storing them. Invalid signatures return `401` and are logged but not queued.

This means:
- Secrets never leave the cloud
- Hosts receive pre-verified payloads
- No need for hosts to verify signatures themselves

### Host Authentication

Webhook deliveries ride the existing heartbeat channel, which is already authenticated
via `REFLECTT_HOST_TOKEN` + host credential from `/api/hosts/claim`.

### Endpoint Security

- Webhook URLs contain the host ID (UUID), providing obscurity
- Rate limiting prevents abuse
- Payload size limits prevent resource exhaustion
- Source-specific validation (GitHub IP allowlist, Stripe IP ranges) as optional hardening

## Dashboard Integration

### Cloud Dashboard
- List of configured webhook sources per host
- Delivery status: queued, delivered, acked, failed, DLQ
- Retry controls: manual retry, purge DLQ
- Webhook volume metrics

### Host Dashboard
- Recent webhook deliveries with processing result
- Task updates triggered by webhooks
- Error log for failed processing

## API Summary

### Cloud Endpoints (new)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhooks/:hostId/:source` | Receive inbound webhook |
| GET | `/api/hosts/:id/webhooks` | List webhook deliveries for host |
| POST | `/api/hosts/:id/webhooks/:deliveryId/retry` | Manual retry from DLQ |
| DELETE | `/api/hosts/:id/webhooks/dlq` | Purge DLQ |

### Host Endpoints (extended)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/webhooks/ledger` | Local delivery ledger |
| GET | `/webhooks/ledger/:deliveryId` | Delivery detail + processing result |

### Heartbeat Extensions
- Response: `webhooks[]` array with pending deliveries
- Request: `webhook_acks[]` array with processed delivery IDs

## Implementation Plan

### Phase 1: MVP (heartbeat pull)
1. Cloud: `POST /api/webhooks/:hostId/:source` — receive + store
2. Cloud: piggyback pending webhooks on heartbeat response
3. Host: process webhooks from heartbeat, ack on next heartbeat
4. Host: local delivery ledger for dedup
5. GitHub PR handler as first integration

### Phase 2: Reliability
6. Cloud: retry engine with exponential backoff
7. Cloud: DLQ with manual retry
8. Cloud: webhook signature verification (GitHub first)
9. Host: error handling + partial processing

### Phase 3: Scale
10. WebSocket push delivery
11. Additional sources (Stripe, Vercel, generic)
12. Dashboard integration (cloud + host)
13. Webhook filtering by event type

## Open Questions

1. **Heartbeat interval for webhook-heavy hosts?** Default 30s may be too slow for CI-heavy teams. Consider adaptive interval or webhook-specific poll.
2. **Payload retention?** Currently full body stored. For Stripe (large payloads), consider storing only event metadata + letting host fetch full payload from Stripe API.
3. **Multi-host routing?** If a team has multiple hosts, should webhooks go to all or route to specific host? Start with single-host, add routing later.

---

*Author: Link | Task: task-1771258255707-23aesdzd5 | Date: 2026-02-16*
