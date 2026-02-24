# Copy Acceptance Checklist (v1)

Use this for **any copy/content artifact** before asking for review. Goal: make review deterministic and activation-oriented.

If any **BLOCKER** fails, do **not** move the task to `validating`.

---

## 1) CTA validity (**BLOCKER**)

### 1.1 CTA inventory
List every CTA exactly as it appears:

| Surface | CTA label | Intended action/route | Exists? (Y/N) | Notes |
|---|---|---|---|---|

### 1.2 Rules
- Primary CTA is singular and action-first.
- Label matches the *real* next step (avoid vague “Get started”).
- CTA does not promise behavior that is not implemented.
- Prefer **nav labels** (e.g., “Dashboard → Hosts”) over hard-coded routes unless routes are validated.

**BLOCKER PASS/FAIL:** ____

---

## 2) State-text consistency (**BLOCKER**)

| State | What user sees | Copy claim | Consistent? (Y/N) | Fix |
|---|---|---|---|---|

Common states:
- empty / no data
- loading / connecting
- connected / online
- error / degraded / offline
- queued / executing

Rules:
- Use concrete signals ("ONLINE", “heartbeat visible”, “task appears in list”).
- Avoid implied guarantees (“instant”, “always”, “automatic”) unless proven.

**BLOCKER PASS/FAIL:** ____

---

## 3) Metric hypothesis per section (**BLOCKER**)

| Section | User action targeted | Metric | Baseline | Target | Why this copy should move it |
|---|---|---|---|---|---|

Examples:
- Empty hosts → host connect starts
- Help FAQ → fewer “where does execution run?” tickets
- Support banner → fewer misrouted DMs / faster triage

**BLOCKER PASS/FAIL:** ____

---

## 4) Trust + ambiguity audit (non-blocker unless misleading)

### 4.1 Local vs cloud runtime location
If runtime location matters, use canonical nouns:
- “cloud control plane”
- “local host runtime”

Avoid unqualified ambiguity:
- “runs in the cloud”
- “serverless execution”
- “we execute tasks for you”

### 4.2 Support/SLA clarity
- No hidden rules: disclose ticket-first if true.
- Escalation expectations are explicit.

---

## 5) Required review request format

Paste into task comment:
1) shipped: `<artifact_path> + checklist filled + timestamp`
2) blocker: `<none OR owner+need>`
3) next+ETA: `<patch ETA or move-to-validating request>`

---

## Worked example

See process artifact example (task-scoped):
- `process/TASK-task-1771345672442-lo7wylkzq-copy-acceptance-checklist-v1-20260223.md`
