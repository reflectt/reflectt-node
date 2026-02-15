# Known Issues (runtime vs docs contract drift)

This page tracks **verified** mismatches between documented API behavior and live runtime behavior.

For each issue, include:
- reproducible steps
- observed vs expected result
- current workaround
- owner and next fix

---

## KI-001 — `/tasks/:id/claim` may fail under strict status contract

**Status:** Open  
**Owner:** `harmony` (runtime contract), `echo` (docs sync)  
**First seen:** 2026-02-14  
**Next fix:** make claim route set required `metadata.eta` automatically (or return explicit 4xx contract error with actionable message)

### Repro steps

1. Create a task in `todo`:

```bash
curl -s -X POST http://127.0.0.1:4445/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title":"claim drift repro",
    "description":"claim route mismatch",
    "status":"todo",
    "assignee":"echo",
    "reviewer":"kai",
    "done_criteria":["repro"],
    "eta":"15m",
    "createdBy":"echo"
  }'
```

2. Claim it:

```bash
curl -s -X POST http://127.0.0.1:4445/tasks/TASK_ID/claim \
  -H 'Content-Type: application/json' \
  -d '{"agent":"echo"}'
```

### Expected

- Claim succeeds and task transitions to `doing` in one step.
- If contract requirements are missing, API returns explicit 4xx with clear remediation.

### Observed

- In strict-contract runtime states, claim path may fail because `doing` requires `metadata.eta`.
- Behavior may surface as server error or contract rejection depending on active build.

### Workaround

- Use explicit patch path with required metadata:

```bash
curl -s -X PATCH http://127.0.0.1:4445/tasks/TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"doing",
    "actor":"echo",
    "metadata":{"eta":"30m"}
  }'
```

---

## KI-002 — Runtime can drift from source/docs until deploy restart

**Status:** Open  
**Owner:** `kai` (deploy flow), `echo` (docs sync)  
**First seen:** 2026-02-14  
**Next fix:** enforce PR-only deploy flow and deploy marker checks before review

### Repro steps

1. Change docs/source in repo.
2. Keep long-running server process without full rebuild/restart.
3. Compare runtime behavior with newly documented contract.

### Expected

- Runtime behavior matches source/docs after shipping changes.

### Observed

- Runtime may continue serving older behavior until rebuild/restart.

### Workaround

- Check deploy status endpoint before validation:

```bash
curl -s http://127.0.0.1:4445/release/status
```

- Run rebuild/restart via standard deploy path before QA signoff.
