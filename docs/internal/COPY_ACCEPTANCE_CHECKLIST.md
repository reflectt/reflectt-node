# Copy Acceptance Checklist (v1.1)

Use this for **any user-facing text** (docs, onboarding, UI strings, empty/error states, marketing pages) before asking for review.

## 10-second clarity
- **Who:** anyone shipping user-facing text
- **When:** before moving a copy/content task to `validating`
- **Output:** filled tables + evidence links + explicit **PASS/FAIL** for each BLOCKER

If any **BLOCKER** fails, do **not** move the task to `validating`.

---

## 0) 10-second clarity (recommended)

Fill this first. If you can’t answer these in 10 seconds, the rest of the checklist won’t save the copy.

- **Who it’s for:** _<one short phrase>_
- **One-sentence promise:** _<what they get / what changes>_
- **Primary CTA:** _<exact label + intended action>_

---

## Definitions
- **Copy/content artifact:** any document, page, PR, screenshot pack, or UI string set that changes what users read.
- **CTA:** any clickable “next step” (button/link/command) that asks the user to do something.

---

## 1) CTA validity + intent (**BLOCKER**)

### 1.1 CTA inventory (must be complete)
List every CTA exactly as it appears.

| Surface | Section | CTA copy (exact) | Destination (nav label + route/slug if known) | Expected user intent | Pass criteria | Exists + works? (Y/N) | Proof (link/screenshot/code ref) | Notes |
|---|---|---|---|---|---|---|---|---|

### 1.2 Rules
- Primary CTA is singular and action-first.
- Label matches the *real* next step (avoid vague “Get started”).
- CTA does not promise behavior that is not implemented.
- Prefer **nav labels** (“Hosts page”, “Tasks page”) over hard-coded routes unless you can prove routes are canonical.
- **CTA validity cannot PASS with unknowns:** if any row is not verifiably real (Exists+works ≠ `Y`, destination unknown, or proof missing), this BLOCKER is **FAIL**. Either validate it, or remove/rewrite it as non-CTA guidance.

**BLOCKER PASS/FAIL (explain if FAIL):** ____

---

## 2) State-text consistency (**BLOCKER**)

Copy must not contradict UI reality.

| Surface | State | What user sees (screenshot OR exact UI strings) | Copy claim | Consistent? (Y/N) | Proof (link/screenshot) | Fix |
|---|---|---|---|---|---|---|

Minimum states to cover (where applicable):
- empty / no data
- loading / connecting
- success / connected / online
- error / degraded / offline
- queued / executing
- auth/permission failure (401/403, missing role, missing host permission)

Rules:
- Use concrete signals ("ONLINE", “heartbeat visible”, “task appears in list”).
- Avoid implied guarantees (“instant”, “always”, “automatic”) unless proven.

**BLOCKER PASS/FAIL (explain if FAIL):** ____

---

## 3) Metric hypothesis + instrumentation (**BLOCKER**)

Without instrumentation proof, metric debates become opinion. If an event does not exist yet, you must either:
- add it in the same PR, **or**
- open a follow-on instrumentation task and link it here.

Baseline/Target may be `unknown`, but you must specify **how it is measured**.

Rule: your **metric name must match its source** (event/log/dashboard). If you can only measure “join token generated”, don’t claim the metric is “host connect started” until that event exists.

| Section | User action targeted | Primary metric | Event name(s) / source | Where it fires (screen/action OR file/handler) | How to verify (<2 min) | Baseline (ok: unknown) | Target (ok: directional) | Why this copy should move it |
|---|---|---|---|---|---|---|---|---|

**BLOCKER PASS/FAIL (explain if FAIL):** ____

---

## 4) Guardrail + rollback (**BLOCKER**)

| Change area | Guardrail metric (must not regress) | Source (event/log/dashboard) | Rollback trigger (exact threshold) | Rollback plan |
|---|---|---|---|---|

Examples:
- Guardrail: host connect completion rate, task creation success rate, error rate, support ticket volume.

**BLOCKER PASS/FAIL (explain if FAIL):** ____

---

## 5) Trust + ambiguity audit (non-blocker unless misleading)

### 5.1 Local vs cloud runtime location
If runtime location matters, use canonical nouns:
- “cloud control plane”
- “local host runtime”

Avoid unqualified ambiguity:
- “runs in the cloud”
- “serverless execution”
- “we execute tasks for you”

### 5.2 Support/SLA clarity
- No hidden rules: disclose ticket-first if true.
- Escalation expectations are explicit.

---

## 6) Open risks + proof (required)

- [ ] **Invite label exists as written** (attach proof):
  - UI label text (exact): ____
  - Route slug (if applicable): ____
  - Proof: ____ (screenshot/link)

- [ ] Any other route/label drift risk called out + mitigated (nav labels preferred over hardcoded paths).

---

## 7) Required review request format

Paste into task comment:
1) shipped: `<artifact_path> + checklist filled + timestamp`
2) blocker: `<none OR owner+need>`
3) next+ETA: `<patch ETA or move-to-validating request>`

---

## 8) Mini worked example (for clarity)

CTA row example:
| Surface | Section | CTA copy | Destination | Intent | Pass criteria | Exists + works | Proof | Notes |
|---|---|---|---|---|---|---|---|---|
| Web app | Empty Hosts | Generate Join Token | Hosts page (`/hosts`) | start host connect | token appears; copy button works | Y | screenshot + route file path | — |

Metric row example:
| Section | Action | Metric | Event/source | Where | Verify | Baseline | Target | Why |
|---|---|---|---|---|---|---|---|---|
| Hosts empty | click token | host_connect_started | `analytics.host_connect_started` | token modal CTA | click + see event in logs | unknown | + | removes ambiguity |

Fail-case reminder:
- If you include a CTA like “Invite teammate” but can’t prove the UI label/flow exists yet, CTA validity must be marked **FAIL** (or remove it from the inventory until validated).
