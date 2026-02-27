# TASK-ul0fheod6 — Fix SHIP digest hallucinations

## Summary
Added `validateReviewPacket()` gate to shipped-heartbeat that requires real review packets before emitting SHIP entries. Prevents zombie tasks with N/A proofs from polluting digests.

## Validation rules
1. `pr_url` must start with `https://github.com/`
2. `commit` must be >= 7 chars OR `pr_integrity.valid=true`
3. Transition reason must not contain "zombie"
4. `qa_bundle.review_packet` must exist

## Tests
12 new tests covering all paths. `npx tsx --test`: 12/12 pass.

## Files
- `src/shipped-heartbeat.ts` (+58 lines)
- `tests/shipped-heartbeat-validation.test.ts` (new, 115 lines)
