# TASK task-1771202987440-hjy70n0yr — reviewer approve/reject endpoint

## Shipped
Added an in-tool reviewer decision endpoint to reflectt-node so assigned reviewers can approve/reject with commentary directly via task API.

## API
New endpoint:
- `POST /tasks/:id/review`

Request body:
```json
{
  "reviewer": "agent-name",
  "decision": "approve",
  "comment": "LGTM with QA bundle attached"
}
```

Behavior:
- resolves full task ID or unique prefix
- rejects ambiguous prefixes with guided suggestions
- only assigned reviewer can submit decision (`403` otherwise)
- supports `approve` and `reject`
- writes decision into task metadata:
  - `metadata.reviewer_approved` (boolean)
  - `metadata.reviewer_decision` (`decision`, `reviewer`, `comment`, `decidedAt`)
  - `metadata.reviewer_notes`
- appends task comment audit line (`[review] approved|rejected: ...`)

## Files changed
- `src/server.ts`
  - added `TaskReviewDecisionSchema`
  - added `POST /tasks/:id/review` route and reviewer authorization checks
- `tests/api.test.ts`
  - added coverage for:
    - non-assigned reviewer rejection
    - approve decision metadata update
    - reject decision metadata update
- `public/docs.md`
  - documented new `/tasks/:id/review` endpoint under Tasks table

## Validation
- `npm run build` ✅
- `npm test` ⚠️ known baseline flakes still present in this repo snapshot:
  - `Idle Nudge shipped cooldown` expectation variance (`below-warn-threshold` vs `recent-shipped-cooldown`)
  - `GET /metrics` strict response time threshold occasionally >100ms
- New reviewer-endpoint tests pass.

## PR
- (to be added)
