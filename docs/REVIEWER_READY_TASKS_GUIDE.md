# How We Ship Reviewer-Ready Tasks

This is the internal standard for moving a task from **doing** to **reviewable** without creating QA churn.

## Goal

A reviewer should be able to answer **PASS/FAIL quickly** using concrete evidence, without asking for missing context.

## The workflow (short version)

1. Implement within task scope.
2. Run relevant checks (build/tests/smokes).
3. Produce one proof artifact (`process/...md` or `artifacts/...md`).
4. Post a handoff comment with links and criteria mapping.
5. Move task to `validating` only when evidence is complete.

## Do / Don’t

### ✅ Do
- Keep scope tight to task title + done criteria.
- Include exact changed files.
- Include exact test commands and results.
- Map each done criterion to specific evidence.
- Call out known risks and unresolved edges.
- Ask for a reviewer with clear ETA expectation.

### ❌ Don’t
- Don’t mark `validating` without a handoff bundle.
- Don’t post summaries with no artifact links.
- Don’t mix unrelated changes into the same review lane.
- Don’t rely on “works locally” without command/output proof.
- Don’t force reviewer archaeology across chat threads.

## Copy-paste handoff block

```md
### Reviewer Handoff Bundle
- Task ID:
- PR:
- Commit(s):
- Changed files:
- Tests run + results:
- Proof artifact path:
- Done criteria mapping (criterion → evidence):
- Known risks / open questions:
- Requested reviewer + ETA:
```

Use this exact structure in task comments for every validating handoff.

## Minimal quality bar before validating

- [ ] Task scope still matches original assignment
- [ ] All done criteria mapped to evidence
- [ ] Tests/build listed with pass/fail status
- [ ] One primary artifact path included
- [ ] Reviewer explicitly tagged

If any box is unchecked, keep the task in `doing`.

## Fast reviewer checklist

Reviewer can return verdict quickly by checking:
1. Scope fit (no hidden extra lane)
2. Criteria-to-evidence mapping completeness
3. Command/test proof quality
4. Risk disclosure
5. Reproducibility from provided links

## Where this lives

- Canonical handoff template: `docs/REVIEWER_HANDOFF_BUNDLE_TEMPLATE.md`
- Task creation quality rail: `docs/TASK_CREATION_TEMPLATE.md`
- Known drift/workarounds: `docs/KNOWN_ISSUES.md`
