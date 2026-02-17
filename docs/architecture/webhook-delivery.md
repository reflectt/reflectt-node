# Architecture: Webhook Delivery Semantics

> Idempotency keys, exponential backoff retries, dead letter queue, replay UI.

## Overview

The webhook delivery engine provides durable, at-least-once delivery for
outbound webhooks. Every webhook gets an idempotency key, failed deliveries
retry with exponential backoff, permanently failed events land in a dead
letter queue (DLQ), and any event can be replayed from the audit trail.

## Delivery Flow

```
Enqueue (POST /webhooks/deliver)
    │
    ▼
┌─────────┐  success   ┌───────────┐
│ pending  │──────────▶ │ delivered │
└────┬────┘            └───────────┘
     │ fail
     ▼
┌──────────┐  retry due  ┌────────────┐  success  ┌───────────┐
│ retrying │────────────▶ │ delivering │─────────▶ │ delivered │
└────┬─────┘             └─────┬──────┘           └───────────┘
     │                         │ fail (< max)
     │                         ▼
     │                    ┌──────────┐
     │                    │ retrying │ (backoff)
     │                    └──────────┘
     │ max attempts
     ▼
┌─────────────┐  replay  ┌─────────┐
│ dead_letter │────────▶ │ pending │ (new idempotency key)
└─────────────┘          └─────────┘
```

## Idempotency

Every webhook event gets a unique `idempotencyKey` (format: `idk_<uuid>`).
If a caller provides an idempotency key that already exists, the existing
event is returned without creating a duplicate. This prevents double-delivery
in at-least-once systems.

Headers sent with each delivery:
```
X-Webhook-ID: whe_<id>
X-Idempotency-Key: idk_<uuid>
X-Webhook-Event: push
X-Webhook-Provider: github
X-Webhook-Attempt: 2
X-Webhook-Timestamp: 1771286000000
```

## Retry Strategy

Exponential backoff with jitter:

```
delay = initialBackoff × multiplier^(attempt-1) × (1 ± 20% jitter)
capped at maxBackoff
```

Default config:
| Parameter | Default | Description |
|-----------|---------|-------------|
| maxAttempts | 5 | Total delivery attempts before DLQ |
| initialBackoffMs | 1,000 | First retry delay |
| maxBackoffMs | 300,000 | Maximum retry delay (5 min) |
| backoffMultiplier | 2 | Exponential growth factor |
| deliveryTimeoutMs | 30,000 | Per-attempt timeout |
| maxConcurrent | 10 | Max parallel deliveries |

Example progression: 1s → 2s → 4s → 8s → DLQ

## Dead Letter Queue

Events that exhaust all retry attempts move to `dead_letter` status:
- Preserved with full payload and error history
- Queryable via `GET /webhooks/dlq`
- Can be replayed: `POST /webhooks/events/:id/replay`
  - Creates new event with fresh idempotency key
  - Original event preserved for audit

## Payload Retention (TTL)

- Default retention: 7 days
- Configurable per-event or globally via `PATCH /webhooks/config`
- Expired **delivered** events are purged hourly
- DLQ events are NOT auto-purged (must be manually resolved)

## Storage

SQLite-backed via the shared `~/.reflectt/data/reflectt.db`:

```sql
webhook_events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  provider TEXT,
  event_type TEXT,
  payload TEXT,         -- JSON string
  target_url TEXT,
  status TEXT,          -- pending|delivering|delivered|retrying|dead_letter
  attempts INTEGER,
  max_attempts INTEGER,
  next_retry_at INTEGER,
  last_attempt_at INTEGER,
  last_error TEXT,
  last_status_code INTEGER,
  delivered_at INTEGER,
  created_at INTEGER,
  expires_at INTEGER,
  metadata TEXT         -- JSON string
)
```

Indexes on: `status`, `next_retry_at`, `provider`, `expires_at`, `idempotency_key`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks/deliver` | Enqueue webhook for delivery |
| GET | `/webhooks/events` | List events (filter by status/provider) |
| GET | `/webhooks/events/:id` | Get event details |
| POST | `/webhooks/events/:id/replay` | Replay from DLQ or audit trail |
| GET | `/webhooks/dlq` | Dead letter queue |
| GET | `/webhooks/stats` | Delivery statistics |
| PATCH | `/webhooks/config` | Update delivery config |
| GET | `/webhooks/idempotency/:key` | Lookup by idempotency key |

## Background Loops

- **Retry processor**: Runs every 5s, picks up `retrying` events past their `next_retry_at`
- **Cleanup**: Runs hourly, purges expired delivered events past TTL

Both loops use `unref()` — they won't keep the process alive.

## Dependencies

- `src/db.ts` — SQLite connection (shared database)
- `src/provisioning.ts` — Webhook route configuration
- `src/secrets.ts` — Webhook signing secrets (future: signature verification)
