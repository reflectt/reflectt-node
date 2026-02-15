# Release Note — OpenClaw 2026.2.13 + Memory Search Rollout

## What changed

We upgraded OpenClaw from `2026.2.9` to `2026.2.13` and rolled memory search into daily workflow.

Memory search now provides semantic recall across memory files, so agents can retrieve relevant prior context faster instead of relying only on exact keyword matching.

## Why this matters

- **Fewer context misses:** decisions and prior artifacts are easier to recover.
- **Faster handoffs:** reviewer and owner context can be found without digging through long chat logs.
- **Less repeat work:** known issues, prior fixes, and established templates are easier to reuse.

## Impact highlights

- Semantic lookup is now part of the standard recall flow for history-sensitive work.
- Team can reference prior task decisions with lower token/time overhead.
- Improves consistency for docs, QA handoffs, and recurring operational checks.

## Rollout caveats (important)

- **Treat search output as candidate context, not truth.** Confirm against source artifacts when decisions are high-impact.
- **If results look incomplete, retry after index catch-up windows.** Fresh content can lag indexing.
- **Use source-linked verification for closes/reviews.** Search helps discovery; artifacts still gate acceptance.

## Safe usage pattern

1. Run memory search to find likely context.
2. Open the referenced artifact/message/task.
3. Confirm exact fields (owner, reviewer, done criteria, status gates) before acting.
4. Cite concrete evidence in handoff bundles.

## Suggested team default

Use memory search first for:
- prior decisions
- reviewer history
- known issue checks
- recurring task context

Then verify with the latest task artifacts before status transitions.
