# Mitigation Note — task-1772072941748-xfaq211vz (Review SLA alerts absurd wait times)

**Status:** mitigated via root-cause identification + handoff task created (fix pending).

## What happened
Review SLA breach alerts in #general show absurd waiting times (hundreds of thousands to >1,000,000 minutes). This created repeated noise and incorrect urgency.

In addition, at least one task reached `done` while lacking an explicit `/tasks/:id/review` decision record, which makes it ambiguous whether reviewer sign-off happened in-system vs “socially”.

## Root cause (most likely)
1. **Duration unit conversion bug** in the SLA alert formatter:
   - Observed numbers are consistent with dividing milliseconds by `60` (or otherwise off by a factor of `1000`) instead of converting correctly to minutes (`ms / 60000`).
   - Example (makes the factor-of-1000 undeniable):
     - If a task has been waiting ~9h, that's `9 * 60 * 60 * 1000 = 32,400,000 ms`.
     - Correct minutes: `32,400,000 / 60000 = 540 minutes`.
     - Buggy minutes (divide by 60): `32,400,000 / 60 = 540,000` → exactly the kind of “hundreds of thousands of minutes” we’re seeing.
2. **Artifact/reviewer drift adds to confusion**:
   - Doc-only tasks without a PR URL may have artifacts living only in another agent’s workspace.
   - The artifacts resolver checks current workspace + shared workspace + GitHub fallback; without PR URL, fallback can’t fetch.
   - When reviewers are re-assigned, the alert text can lag behind current `task.reviewer`.

## Evidence
- Multiple SLA pings showing 600k–1M minutes; if interpreted as “minutes * 60ms”, that’s ~10–17h, plausible.
- `GET /tasks/task-1771972183690-zp18ba60m/artifacts` initially failed until the artifact was copied into **workspace-shared**; then it resolved successfully.

## Mitigation / next actions
- **Fix task created:** `task-1772038600515-ay6uv756d` (P0) — "Bug: review SLA breach alert duration units are wrong (ms->minutes conversion)".
- Recommend adding a gate: doc-only validating tasks must have artifact_path resolvable via shared workspace (or require a URL/PR).
- Recommend alert generation uses live `task.reviewer` at send time (avoid cached reviewer).

## Notes
This task is best closed once the fix PR ships + alerts show sane durations.
