# QA Bundle — task-1772802018782-025vzgyh4

PR: https://github.com/reflectt/reflectt-node/pull/696

## Root cause
`Sweeper Digest` suppression was effectively **in-memory only** (either via a local fingerprint cache, or via `alert-preflight`’s short idempotency window). When `reflectt-node` restarted (deploy, crash, dev reload), that in-memory state reset and the same unchanged open violation(s) could get re-emitted again.

This is why we saw repeated identical digest notifications even though the underlying task/violation was unchanged.

## Fix (suppression key + window)
In `src/executionSweeper.ts`:

- Compute a **stable digest fingerprint** from the set of violations: sorted `"{type}:{taskId}"` entries.
  - Intentionally ignores `age_minutes` and titles to avoid churn.
- Add **persistent** suppression using `SuppressionLedger` (SQLite) with a **2 hour** window:
  - `category: "sweeper_digest"`
  - `content: "fp=<fingerprint>"` (stable, avoids `age_minutes` churn)
- Keep the existing in-process suppression map as a cheap extra guard within a single uptime.

**Suppression window:** 2h

## Before / After
**Before:** restart/cold-start could spam the same digest again for the same unchanged open violations.

**After:** identical digest fingerprints are suppressed for **2 hours even across restarts**. A new digest can still emit immediately if the violation set meaningfully changes (new fingerprint).

## Tests / Proof
Unit tests updated in `tests/sweeper-digest-dedupe.test.ts`:

- suppresses repeated identical digests within window
- re-emits after window elapses
- does not suppress when violation set changes
- **new regression:** suppresses identical digests across an in-memory reset (simulated restart)

Proof:

```bash
npm test
```

## Review Packet
```json
{
  "task_id": "task-1772802018782-025vzgyh4",
  "pr_url": "https://github.com/reflectt/reflectt-node/pull/696",
  "commit": "4d114d0ebbf82562d6c91dfcbdd79b5b7565fe3a",
  "changed_files": [
    ".gitignore",
    "process/TASK-025vzgyh4-sweeper-digest-dedupe.md",
    "src/executionSweeper.ts",
    "tests/sweeper-digest-dedupe.test.ts"
  ],
  "artifact_path": "process/TASK-025vzgyh4-sweeper-digest-dedupe.md",
  "caveats": [
    "Suppression is keyed by digest fingerprint (type+taskId set); if the violation set changes, a new digest can emit immediately.",
    "If PR head changes, update commit/changed_files to match (or set metadata.pr_integrity_override=true)."
  ]
}
```
