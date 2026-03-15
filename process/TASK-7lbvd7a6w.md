# Process: task-1773605740669 — Domain reviewer auto-assignment

## Task
Wire domain-based reviewer routing into task creation when reviewer field is empty.

## Changes
- `defaults/reviewer-routing.yaml`: machine-readable domain chain spec (canvas/ui→pixel, android→kotlin, ios→swift, security→shield, node/api→link, catch-all→kai)
- `src/assignment.ts`: `loadReviewerRouting()`, `matchDomainChain()` helpers; `suggestReviewer()` now applies domain chain on eligible candidates (after `agentEligibleForTask` pass) before falling back to load-balanced scoring
- `process/reviewer-routing.yaml`: copy of spec for sage's task artifact

## Key decision
Domain chain applied AFTER eligibility filtering to preserve design-lane guardrails. This means `pixel` only gets domain-routed to canvas/UI tasks when `agentEligibleForTask` passes (which respects `lane=design` metadata and tag matching).

## AC
- [x] canvas/UI/frontend → pixel (fallback: link)
- [x] android → kotlin (fallback: link)
- [x] ios → swift (fallback: link)
- [x] security → shield (fallback: sage)
- [x] node/api/backend → link (fallback: kai)
- [x] catch-all → kai
- [x] Self-review conflict (assignee = primary) → uses fallback
- [x] Design-lane guardrail tests pass (pixel-routing-guardrail.test.ts)
