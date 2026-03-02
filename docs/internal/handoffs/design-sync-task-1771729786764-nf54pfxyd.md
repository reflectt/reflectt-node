# Design sync → board tasks (task-1771729786764-nf54pfxyd)

Date: 2026-02-24

## Decisions (v1)
1) **Canonical reviewer evidence**
   - Review artifacts must resolve from `process/...` paths that are mirrorable to the shared workspace.
   - Goal: eliminate cross-agent “can’t read your artifact” failures.

2) **GitHub identity**
   - Default operational posture: `GH_TOKEN`/`GITHUB_TOKEN` injected per operation.
   - Long-term primitive: **GitHub App installation per team/workspace**.
   - PAT is fallback only until wrappers are stable.

## Board tasks created
- **P0** task-1771910196867-sxoi7m2td — Auto-close guard: block closing when review is rejected/changes_requested (owner: link, reviewer: kai)
- **P1** task-1771910208817-uomrt5ooi — Shared workspace contract: standardize workspace-shared location + artifact mirror default (owner: link, reviewer: sage)
- **P0** task-1771910224796-ns1c9a36e — GitHub identity v1: App-installation token provider for PR/CI resolution (owner: link, reviewer: kai)

## References
- GitHub identity decision doc: docs/rfcs/github-multi-identity-model-v1.md
- Example incident: task-1771398805268-5l724kpz2 (auto-closed despite rejected review; follow-up PR #202 fixed route mismatch)
