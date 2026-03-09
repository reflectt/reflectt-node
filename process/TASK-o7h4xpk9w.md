# TASK-o7h4xpk9w — Cross-host regression surfacing (cloud)

**Task:** task-1772920729800-o7h4xpk9w  
**Owner:** sage  
**Reviewer:** rhythm  
**Status:** spec / follow-up ready

## Goal
Surface a cloud-level signal when a recent PR correlates with a *new* failure pattern across multiple hosts, so the team can catch regressions before they spread.

## 1) Regression signal we surface
A regression candidate is a tuple:
- **code change anchor:** PR URL + commit/deploy signature
- **failure fingerprint:** normalized error class / message / affected endpoint or worker
- **spread:** number of distinct hosts showing the fingerprint after the code change
- **confidence:** low / medium / high based on host count, timing, and baseline delta

### Feed item shape (MVP)
```json
{
  "id": "reg-20260308-abc123",
  "repo": "reflectt/reflectt-node",
  "pr_url": "https://github.com/reflectt/reflectt-node/pull/804",
  "commit_sha": "72dce9f...",
  "failure_fingerprint": "task_comments.missing_after_patch",
  "first_seen_at": "2026-03-08T17:00:00Z",
  "hosts_affected": 4,
  "host_ids": ["mac-daddy", "docker-backoffice", "evi-fly", "customer-host-12"],
  "baseline_hosts": 0,
  "post_deploy_hosts": 4,
  "severity": "high",
  "confidence": "high",
  "sample_symptom": "review_handoff.comment_id does not resolve via GET /tasks/:id/comments",
  "status": "open"
}
```

## 2) Correlation method
For each host deploy or commit change, compute a rolling comparison:

### Step A — anchor the deployment
For each host, record:
- host_id
- repo / runtime
- commit SHA or deploy signature
- first heartbeat / deploy attestation timestamp after change

### Step B — cluster failures into fingerprints
Normalize errors into a stable fingerprint from available data, e.g.:
- endpoint/worker name
- top-level error type
- normalized message template (strip ids/timestamps)
- optional stack top frame / subsystem tag

### Step C — compare before vs after
For each PR/commit:
- **lookback baseline:** 24h before first affected-host deploy
- **post-deploy window:** 6h after deploy per host
- count hosts with the fingerprint before and after

### Step D — promote to regression candidate
Emit a regression candidate when:
- the same fingerprint appears on **>= 3 distinct hosts**
- those hosts share the **same recent PR/commit/deploy signature**
- the fingerprint was **absent or materially lower** in the baseline window
- the signal is not explained by one known host outage / stale heartbeat cluster

## 3) Thresholds / false-positive controls
### Initial thresholds
- **Minimum spread:** 3 hosts
- **Post-deploy window:** 6h from first affected deploy
- **Baseline window:** 24h before first affected deploy
- **Material increase:**
  - baseline hosts = 0 and post-deploy hosts >= 3, or
  - post-deploy host count >= 3x baseline host count
- **Re-alert cooldown:** 12h per `(commit_sha, fingerprint)`

### False-positive controls
1. **Heartbeat/outage guard:** don’t count hosts whose heartbeats are stale or whose deploy attestation is missing.
2. **Known-global outage guard:** suppress when many unrelated fingerprints spike simultaneously (likely infra/provider outage).
3. **Version-majority guard:** compare only among hosts that actually moved onto the same deploy signature.
4. **Noise dedupe:** one regression card per `(repo, commit_sha, fingerprint)`.
5. **Low-sample quarantine:** 2-host events stay internal/debug only, not surfaced to team leads.

## 4) Minimal data sources
## Already available / likely available
### In cloud
- host inventory + host IDs
- host heartbeat recency
- deploy attestation / version mismatch view in hosts UI
- per-host task / PR metadata flowing through synced task state

### In node
- `/health/deploy` style commit/deploy signature
- task metadata fields such as `pr_url`, `commit_sha`, `review_handoff.pr_url`
- activity / chat / task comments that often expose repeated failures

## Missing instrumentation for MVP-confidence
1. **Host-level error event stream** to cloud with:
   - timestamp
   - host_id
   - subsystem / endpoint / worker
   - normalized fingerprint
   - sample message
2. **Per-host deploy transition record** (when host changed from old commit -> new commit)
3. **Repo association on deploy signature** for multi-repo fleets (`reflectt-node` vs `reflectt-cloud`-managed host runtime concerns)

Without #1, MVP can still use coarse proxies (e.g. repeated task/comment/review failures by host), but confidence will be lower.

## 5) MVP UI / endpoint / notification path
### Endpoint
`GET /api/regressions?status=open&limit=20`

Returns a feed of open regression candidates, sorted by severity then affected hosts.

### UI
Add a small **Regressions** panel in cloud Overview / Hosts:
- title: `Cross-host regressions`
- default view: top 5 open candidates
- columns:
  - repo / PR
  - fingerprint
  - affected hosts
  - first seen
  - confidence
  - action: open PR / host list

### Notification path
When confidence = high:
- send one batched alert in team chat tagging exact owners:
  - `@link` for cloud surfacing / API
  - `@rhythm` for node instrumentation / heartbeat-side evidence path
- format:
  - Need/Bottleneck
  - candidate id / PR / host count
  - next artifact + ETA

## 6) Acceptance test scenario
### Inputs
- Host A deploys PR #804 at 10:00, then emits fingerprint `task_comments.missing_after_patch`
- Host B deploys PR #804 at 10:12, same fingerprint
- Host C deploys PR #804 at 10:20, same fingerprint
- Baseline prior 24h: 0 hosts emitted that fingerprint
- Host D remains on previous commit and does not emit it

### Expected output
`GET /api/regressions` returns one open candidate:
- repo = `reflectt/reflectt-node`
- PR = `#804`
- fingerprint = `task_comments.missing_after_patch`
- hosts_affected = 3
- confidence = `high`
- severity = `high`
- host list = A/B/C only

## 7) Follow-up implementation tasks
### Task A — cloud correlation feed (P1)
- **Owner:** link
- **Reviewer:** sage
- **Title:** Cloud: add `/api/regressions` feed for cross-host regression candidates
- **Scope:** ingest host deploy signature + fingerprint aggregates, compute candidate list, expose feed endpoint

### Task B — node/cloud instrumentation contract (P1)
- **Owner:** rhythm
- **Reviewer:** sage
- **Title:** Node→cloud: emit normalized host error fingerprints + deploy transitions for regression correlation
- **Scope:** define payload + heartbeat/telemetry path for host-level error fingerprints and deploy change events

### Optional Task C — dashboard panel (P2)
- **Owner:** link
- **Reviewer:** pixel
- **Title:** Cloud UI: add Cross-host regressions panel to Overview/Hosts
- **Scope:** show top candidates, confidence, affected hosts, PR link

## Recommendation
Ship this in two stages:
1. **P1 correlation backend + instrumentation contract**
2. **P2 UI panel + alerts**

Constraint-first view: the blocker is not visualization; it is **missing normalized cross-host error fingerprints tied to deploy transitions**. Build that first.