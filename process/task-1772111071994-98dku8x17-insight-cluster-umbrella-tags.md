# task-1772111071994-98dku8x17 — Prevent over-clustering when only an umbrella unit tag is present

## Problem
An insight about OpenClaw channel/session scoping was promoted, but the resulting insight/task context became polluted: unrelated reflections were grouped into the same cluster key (example: `unknown::uncategorized::openclaw`).

This caused:
- mixed evidence (different root causes in one “insight”)
- incorrect/duplicated tasks
- reviewers seeing the wrong “done criteria” + context

## Root cause
`extractClusterKey(reflection)` in `src/insights.ts` derives a 3-part cluster key:
- workflow_stage
- failure_family
- impacted_unit

When reflections lack `stage:` / `family:` tags and include only a broad umbrella tag like `openclaw`, the impacted_unit becomes `openclaw`. Combined with inferred `workflow_stage=unknown` and `failure_family=uncategorized`, unrelated reflections collapse into the same bucket.

## Fix
PR **#413** updates clustering heuristics:
1. Treat umbrella tags (`openclaw`, `reflectt`, `reflectt-node`, …) as *generic* when selecting `impacted_unit` from tags, so more specific tags win when present.
2. If the only unit hint is an umbrella tag, append a small topic signature derived from the reflection pain (e.g. `openclaw-topic-openclaw-channel-scoped-sessions`).

This preserves stable clustering while preventing unrelated problems inside the same umbrella from merging.

## Evidence / reproduction
- Insight `ins-1771953816663-p9kjlk4cb` shows mixed reflection evidence because multiple reflections shared the same coarse key (`unknown::uncategorized::openclaw`).

## Code
- `src/insights.ts`
  - umbrella tags added to “generic” list
  - new helper: `_isUmbrellaUnit` + `_hasOnlyUmbrellaOrGenericUnitTags`
  - `extractClusterKey` appends topic signature when umbrella-only

## Tests
- Added unit test in `tests/insights.test.ts` asserting:
  - tags `["openclaw"]` + pain `"OpenClaw channel-scoped sessions…"` ⇒ impacted_unit `openclaw-topic-openclaw-channel-scoped-sessions`

## PR
- https://github.com/reflectt/reflectt-node/pull/413

## Notes
- CI on `main` is currently failing in `test` (context-budget assertion). This change is isolated to clustering; merge once main test job is green again.
