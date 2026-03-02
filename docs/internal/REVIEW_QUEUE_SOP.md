# Review Queue SOP

How reviewers process `validating` tasks with SLA discipline and minimal churn.

## Purpose

- Keep review turnaround predictable.
- Prevent validating tasks from stalling.
- Standardize PASS/FAIL evidence quality.

---

## Reviewer workflow (default)

1. Pull validating queue.
2. Confirm handoff bundle completeness.
3. Verify done-criteria against evidence.
4. Return explicit `PASS` or `FAIL`.
5. If PASS, confirm close-gate metadata is present.

---

## Step 1 — Pull queue

```bash
curl -s "http://127.0.0.1:4445/tasks?status=validating&limit=50"
```

Prioritize by:
1) oldest waiting item
2) P0/P1 before P2/P3
3) blocker-unblocking tasks first

---

## Step 2 — Handoff bundle check (required)

A reviewer-ready task comment should include:
- PR link
- commit(s)
- changed files
- tests run + results
- proof artifact path
- criteria → evidence mapping

If missing, return `FAIL` quickly with exact missing fields.

Template reference: `docs/REVIEWER_HANDOFF_BUNDLE_TEMPLATE.md`

---

## Step 3 — Evidence validation

For each done criterion:
- find explicit proof (artifact/command/output/path)
- verify relevance (not generic success text)
- note mismatch if proof does not cover criterion

Output pattern:

```md
PASS ✅
- Criterion A: evidence found at ...
- Criterion B: evidence found at ...

or

FAIL ❌
- Missing: <field/proof>
- Fix required: <specific patch>
```

---

## Step 4 — SLA timing

Recommended response target:
- first review pass within 15–30m when queue is active
- if delayed, post reviewer ETA update

When SLA breach alerts fire:
- verify queue entry is real (not stale/closed lane)
- if stale, close/reset task state before re-alerting

---

## Step 5 — Close path after PASS

Before moving to `done`, ensure close gate requirements are present:
- `metadata.artifacts` array
- `metadata.reviewer_approved: true`
- valid `artifact_path`

Example close payload:

```bash
curl -s -X PATCH "http://127.0.0.1:4445/tasks/TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"done",
    "actor":"reviewer",
    "metadata":{
      "artifact_path":"process/TASK-proof.md",
      "artifacts":["https://github.com/reflectt/reflectt-node/pull/123","process/TASK-proof.md"],
      "reviewer_approved":true,
      "eta":"completed"
    }
  }'
```

---

## Common failure cases

1. **No PR link in validating handoff**
   - Action: fail fast, request PR link.

2. **Criteria mapped to summary only (no proof)**
   - Action: require concrete artifact references.

3. **PASS given but close gate missing**
   - Action: block close until metadata contract is complete.

4. **Duplicate reviewer loops**
   - Action: keep single source-of-truth review comment per cycle.

---

## Quick reviewer checklist

- [ ] Task is actually in `validating`
- [ ] Handoff bundle complete
- [ ] Done criteria fully evidenced
- [ ] PASS/FAIL posted with specifics
- [ ] Close metadata contract complete (if PASS)
