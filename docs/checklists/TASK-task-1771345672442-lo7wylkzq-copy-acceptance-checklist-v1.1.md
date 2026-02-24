# Copy Acceptance Checklist v1.1 (Activation + Trust + Instrumentation)

Task: task-1771345672442-lo7wylkzq  
Owner: @echo  
Reviewer: @spark  
Date: 2026-02-24

Purpose: make copy review deterministic by requiring (1) route/nav-valid CTAs, (2) state-text consistency vs real UI states, (3) measurable metric hypotheses w/ instrumentation proof, and (4) rollback guardrails.

---

## Change log (v1 → v1.1)
Added (per @spark requirements):
- Per-section CTA table: **copy + destination + intent + pass/fail**
- State-text proof requirement: **screenshot or exact UI strings** for empty/loading/error/success
- Metric hypothesis requirement now includes **event names + where they fire + how to verify**
- Added **guardrail metric + rollback trigger**
- Made “invite label exists as written” an explicit checkbox requiring **UI label + route slug proof**

---

## How to use (author)
- Fill this checklist for every copy artifact before requesting review.
- If any **BLOCKER** fails, do not move to `validating`.
- If a metric is un-instrumented, you must either:
  - add the event in the same PR, **or**
  - open a follow-on instrumentation task and link it (otherwise metric hypotheses are unreviewable).

## How to use (reviewer)
- Confirm BLOCKERS first.
- Optional improvements only after blockers pass.

---

# 1) CTA validity + intent (BLOCKER)

## 1.1 CTA inventory (must be complete)
List every CTA exactly as it appears.

| Surface | Section | CTA copy (exact) | Destination (nav label + route/slug if known) | Expected user intent | Pass criteria | Exists + works? (Y/N) | Proof (screenshot/link) | Notes |
|---|---|---|---|---|---|---|---|---|

## 1.2 CTA rules
- Primary CTA is singular and action-first.
- CTA copy matches the next step (no vague “Get started”).
- CTA does not promise behavior that isn’t implemented.

**BLOCKER PASS/FAIL:** ____

---

# 2) State-text consistency (BLOCKER)

## 2.1 Required states to validate
For each key state, copy must not contradict UI reality.

| Surface | State | What user sees (screenshot OR exact UI strings) | Copy claim | Consistent? (Y/N) | Fix needed |
|---|---|---|---|---|---|

Minimum states:
- empty / no data
- loading / connecting
- success / connected / online
- error / degraded / offline

## 2.2 Consistency rules
- Use concrete signals (`ONLINE`, “heartbeat visible”, “task appears in list”).
- Avoid implied guarantees (“instant”, “always”, “automatic”) unless proven.

**BLOCKER PASS/FAIL:** ____

---

# 3) Metric hypotheses + instrumentation (BLOCKER)

For each copy block, state the intended measurable outcome.

| Section | User action targeted | Primary metric | Event name(s) | Where event fires (file/handler) | How to verify (click path + what to see) | Baseline | Target | Why this copy should move it |
|---|---|---|---|---|---|---|---|---|

**BLOCKER PASS/FAIL:** ____

---

# 4) Guardrail + rollback (BLOCKER)

| Change area | Guardrail metric (must not regress) | Source (event/log/dashboard) | Rollback trigger (exact threshold) | Rollback plan |
|---|---|---|---|---|

Examples:
- Guardrail: task creation success rate, host connect completion rate, error rate, support ticket volume.

**BLOCKER PASS/FAIL:** ____

---

# 5) Trust + ambiguity audit (NON-BLOCKER unless misleading)

## 5.1 Runtime location wording (if relevant)
- Use canonical nouns:
  - “cloud control plane”
  - “local host runtime”
- Avoid banned ambiguity:
  - “runs in the cloud” (unqualified)
  - “serverless execution”
  - “we execute tasks for you”

## 5.2 Support/SLA clarity
- No hidden rules: disclose ticket-first if true.
- Escalation expectations are explicit.

---

# 6) Open risks + proof (REQUIRED)

- [ ] **Invite label exists as written** (attach proof):
  - UI label text (exact): ____
  - Route slug (if applicable): ____
  - Proof: ____ (screenshot/link)

- [ ] Any other “route/label might drift” risk called out + mitigated (nav labels preferred over hardcoded paths).

---

# 7) Review request format (required)

Paste into task comment:
1) shipped: `<artifact_path> + checklist filled + timestamp`
2) blocker: `<none OR owner+need>`
3) next+ETA: `<patch ETA or move-to-validating request>`

---

# 8) Done-criteria mapping (for this checklist task)

- ✅ Checklist template published (this file)
- ✅ Linked from reviewer-ready tasks guide
- ☐ One live artifact reviewed against checklist (attach below)
- ☐ Reviewer usefulness confirmation from @spark

---

# 9) First live application (fill once before requesting approval)

Artifact reviewed: `____`

## 9.1 CTA inventory
(Include completed table from section 1)

## 9.2 State-text consistency
(Include completed table from section 2)

## 9.3 Metric hypotheses + instrumentation
(Include completed table from section 3)

## 9.4 Guardrail + rollback
(Include completed table from section 4)

**BLOCKER summary:** CTA validity = ___, state consistency = ___, metrics+instrumentation = ___, guardrail+rollback = ___
