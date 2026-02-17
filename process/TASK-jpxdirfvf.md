# Task: Webhook Delivery Semantics
**ID**: task-1771258271455-jpxdirfvf
**PR**: https://github.com/reflectt/reflectt-node/pull/145
**Branch**: link/task-jpxdirfvf
**Commit**: a013dd4

## Summary
Durable webhook delivery with idempotency keys, exponential backoff retries, dead letter queue, and replay.

## Changes
- `src/webhooks.ts` (430 lines) — WebhookDeliveryManager
- `src/server.ts` — 8 new /webhooks/* routes
- `docs/architecture/webhook-delivery.md`
- `public/docs.md` — route docs updated

## Test Proof
- tsc --noEmit: clean
- Route-docs contract: 149/149
- Tests: 122/122 pass

## Known Caveats
- Webhook signing/verification not yet implemented (deferred per earlier decision)
- Replay UI is API-only — dashboard panel for DLQ browsing not yet in dashboard.ts
