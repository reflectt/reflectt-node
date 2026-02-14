# Task-Linkify Promotion Evidence Index (Single Source of Truth)

Task: `task-1771076784853-mnmya5avu`

- last_verified_utc: 2026-02-14T13:28:32Z
- verified_by: link
- verification_ref: PR #3 / run 22017991689

## Operator Flow Map (Promotion Day Open Order)
1. `docs/TASK_LINKIFY_PROMOTION_EVIDENCE_INDEX.md` (this page)
2. `docs/TASK_LINKIFY_PROMOTION_DAY_QUICKSTART.md`
3. `docs/TASK_LINKIFY_LIVE_PROMOTION_CHECKLIST_FINAL.md`
4. `docs/TASK_LINKIFY_REQUIRED_CHECK_RUNBOOK.md`
5. `artifacts/task-linkify/TASK-task-1771075286830-EXECUTION-LEDGER-TEMPLATE.md`
6. `docs/TASK_LINKIFY_PROMOTION_RUN_WINDOW_AND_COMMS.md`
7. `artifacts/task-linkify/TASK-task-1771075439409-BROADCAST-TEMPLATE.md`
8. `tools/task-linkify-promotion-smoke.sh`
9. Latest smoke artifact + PR/run evidence + QA verdict snapshots

## Artifact Inventory

| section | path | commit | timestamp_utc | status | supersedes | owner | reviewer | notes |
|---|---|---|---|---|---|---|---|---|
| runbook | `docs/TASK_LINKIFY_REQUIRED_CHECK_RUNBOOK.md` | `1a108e2` | 2026-02-14T13:13:46Z | verified | `docs/TASK_LINKIFY_REQUIRED_CHECK_RUNBOOK.md@8949c0e` | link | pixel | merge-safe mutation + rollback policy |
| checklist | `docs/TASK_LINKIFY_LIVE_PROMOTION_CHECKLIST_FINAL.md` | `37a4b3d` | 2026-02-14T13:??:??Z | verified | `docs/TASK_LINKIFY_PROMOTION_OPERATOR_HANDOFF.md@e13cd30` | link | pixel | hard-stop dual-confirm gate |
| quickstart | `docs/TASK_LINKIFY_PROMOTION_DAY_QUICKSTART.md` | `49681c3` | 2026-02-14T13:??:??Z | verified | none | link | pixel | one-page operator card |
| comms | `docs/TASK_LINKIFY_PROMOTION_RUN_WINDOW_AND_COMMS.md` | `8d4758a` | 2026-02-14T13:??:??Z | verified | none | link | pixel | includes mandatory `MUTATION=true/false` in-progress field |
| script | `tools/task-linkify-branch-protection-playbook.sh` | `1a108e2` | 2026-02-14T13:13:46Z | verified | none | link | pixel | read/apply/rollback command paths |
| script | `tools/task-linkify-promotion-smoke.sh` | `d75b6f8` | 2026-02-14T13:28:32Z | verified | none | link | pixel | runtime `mutation=false` hard guard |
| template | `artifacts/task-linkify/TASK-task-1771075286830-EXECUTION-LEDGER-TEMPLATE.md` | `37a4b3d` | 2026-02-14T13:??:??Z | verified | none | link | pixel | AUTO_ABORT + dual-confirm fields |
| template | `artifacts/task-linkify/TASK-task-1771075439409-BROADCAST-TEMPLATE.md` | `8d4758a` | 2026-02-14T13:??:??Z | verified | none | link | pixel | comms template with mutation flag |
| template | `artifacts/task-linkify/TASK-task-1771075068288-REHEARSAL-TRANSCRIPT-TEMPLATE.md` | `ab9abfa` | 2026-02-14T13:??:??Z | verified | none | link | pixel | rehearsal logging template |
| evidence | `artifacts/task-linkify/TASK-task-1771075068288-REHEARSAL-TRANSCRIPT-FILLED.md` | `879c1fc` | 2026-02-14T13:19:57Z | verified | `artifacts/task-linkify/TASK-task-1771075068288-REHEARSAL-TRANSCRIPT-TEMPLATE.md@ab9abfa` | link | pixel | non-mutating rehearsal execution proof |
| evidence | `artifacts/task-linkify/TASK-task-1771075581699-ahbf0oa6h-SMOKE-20260214T132832Z.json` | `d75b6f8` | 2026-02-14T13:28:32Z | verified | none | link | pixel | smoke output with schema + blocking failures |
| evidence | `artifacts/task-linkify/TASK-task-1771074249091-DRYRUN-EVIDENCE.md` | `8949c0e` | 2026-02-14T13:06:31Z | verified | none | link | pixel | dry-run check/artifact linkage |
| qa | inline QA verdict chain (Reflectt thread) | n/a | rolling | verified | supersedes older preflight-only verdicts | pixel | kai | PASS gates for each artifact family |

## Stale-Evidence Rule
- Mark any row as `stale` if:
  - evidence is older than current cycle window, or
  - PR/run/artifact linkage cannot be re-verified.
- `stale` rows cannot be sole basis for go-live. Refresh required before promotion.

## Go-Live Readiness Snapshot
- required-check contract stable: ✅ `task-linkify-regression-gate`
- non-mutating rehearsal complete: ✅
- smoke baseline complete: ✅
- operator docs/templates complete: ✅
- rollback paths documented: ✅
