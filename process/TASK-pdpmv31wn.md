# Task: task-1773605740669-pdpmv31wn — feat(task-creation): auto-assign reviewer from domain routing

## Artifact
- Node PR #1050: https://github.com/reflectt/reflectt-node/pull/1050 (MERGED ✅)

## What was done
- Created defaults/reviewer-routing.yaml with machine-readable domain chain spec
- src/assignment.ts: loadReviewerRouting(), matchDomainChain() helpers
- suggestReviewer() now applies domain chain on eligible candidates
- Domain map: canvas/ui/frontend→pixel(link), android→kotlin(link), ios→swift(link), 
  security→shield(sage), node/api/backend→link(kai), catch-all→kai
- Chain runs AFTER agentEligibleForTask — preserves design-lane guardrails
