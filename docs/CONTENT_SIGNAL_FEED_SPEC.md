# Content signal feed (spec)

Status: **Spec (not implemented yet)**

Goal: give docs/content a *real* signal stream so we stop shipping stale endpoints + broken onboarding.

This spec is scoped to what’s **buildable on one node** today, and **aggregatable cross-host** later.

- **Task:** `task-1772920812811-dw6it545w`
- **Primary implementers:** @rhythm (API/storage), @link (if CLI/runtime instrumentation is needed)

---

## Why this exists

Docs drift and broken onboarding don’t show up in CI. They show up as:
- agents hitting endpoints that 404
- docs linking to paths that 404
- docs claiming endpoints/behaviors the runtime doesn’t support

We need a lightweight feed that surfaces these as structured signals, with dedupe.

---

## API contract (MVP)

### `GET /api/signals/content?window=24h`

Returns an array of signal objects (newest first), covering the requested window.

- **Scope:** localhost/internal only (ops telemetry; not a public endpoint)
- **Response:** `200 application/json`

### Signal object shape (minimal)

```json
{
  "id": "sig-...",
  "type": "api_404|doc_runtime_drift|docs_link_404|get_started_step",
  "severity": "P0|P1|P2|P3",
  "hostId": "...",
  "teamId": "...",
  "firstSeenAt": "ISO",
  "lastSeenAt": "ISO",
  "count": 12,
  "dedupeKey": "sha256(...)" ,
  "data": {}
}
```

### Dedupe rules

Make dedupe explicit and deterministic:

- `dedupeKey = sha256(type + hostId + primaryKey + dayBucket)`

Where:
- `dayBucket` = `YYYY-MM-DD` in UTC (or equivalent stable bucket)
- `primaryKey`:
  - `api_404` → `method + " " + path`
  - `docs_link_404` → `url`
  - `doc_runtime_drift` → `docPath + "::" + token`
  - `get_started_step` → `step` (if/when implemented)

---

## Signals (what to implement)

### 1) `api_404` (MVP must-have)

**Intent:** catch docs/runtime drift like `/agents` instantly.

**Trigger:** any HTTP response with status=404.

**Implementation guidance (lowest moving parts):** at the HTTP handler layer, on 404:
- increment counter in SQLite keyed by `(method, path, dayBucket)`
- track `firstSeenAt`, `lastSeenAt`, `count`

**Data payload (suggested):**

```json
{
  "path": "/agents",
  "method": "GET"
}
```

Optional fields (nice-to-have): `userAgent`, `referrer`.

---

### 2) `doc_runtime_drift` (recommended 2nd signal for MVP)

**Intent:** catch when docs claim endpoints that aren’t supported.

**Trigger (MVP):** docs mention an endpoint that is not present in `GET /capabilities` (or fails a quick request).

**Implementation guidance:**
- lightweight script (can live under `tools/`) that:
  - parses `docs/` for `/api/...` and other endpoint-looking tokens
  - compares extracted endpoints against `/capabilities`
  - uses a small allowlist for false positives
- results ingested into signals table via internal insert or an internal `POST /api/signals` endpoint

**Data payload (suggested):**

```json
{
  "docPath": "docs/GETTING-STARTED.md",
  "token": "/agents",
  "observed": "404",
  "expected": "listed in /capabilities"
}
```

---

### 3) `docs_link_404` (v2)

**Intent:** detect broken links across reflectt.ai + docs.

This likely requires crawling/link-check infra; defer until after drift + 404 signal work.

---

### 4) `get_started_step` funnel (v2)

Agree this probably needs CLI/runtime instrumentation. Keep explicitly v2 unless Link is already modifying CLI/runtime.

---

## Storage (suggested)

SQLite table keyed for dedupe and fast rollups.

Minimum fields:
- `dedupeKey` (unique)
- `type`, `severity`
- `hostId`, `teamId` (nullable until available)
- `firstSeenAt`, `lastSeenAt`, `count`
- `data` JSON

---

## Done criteria (for task-1772920812811-dw6it545w)

- `GET /api/signals/content?window=24h` returns stable JSON and respects the window.
- `api_404` implemented and populating signals.
- One of: `doc_runtime_drift` OR `docs_link_404` implemented (recommend drift first).
- Dedupe works (no unbounded spam on repeated identical 404s).
- Short docs entry exists describing the endpoint and how to add new signal types.
