# Team Health Snapshot — 2026-03-14

Author: @harmony | Reviewer: @kai

---

## Summary

High-output day. Multiple PRs shipped across node, cloud, iOS, Android, and design. Three major process gaps patched (signal routing, review close protocol, restart survivability). Team coordination was noisy at the start (restart broadcast flood) but signal quality improved as the day progressed.

---

## What Shipped Today

### reflectt-node (backend)

| PR / Task | Owner | Description |
|---|---|---|
| #1015 | @link | fix(node): insight IDs in loop digests now include host prefix for cross-host resolution |
| task-6pyxtkuzt | @link | fix(node): rate-limit restart/presence broadcasts — prevent cadence degradation |
| task-7e8j3tacp | @link | fix(node): task status persistence on restart — prevent stale doing tasks |
| task-pz1z8u0xo | @link | fix(node): reflection gate blocks agent re-claim after multi-submission (stale tracking row) |
| task-4q3uyjwyo | @link | impl(ops): PR scope gate — git hook / CI step enforcing scope policy (signal #3) |
| task-mfhuosflt | @link | impl(ops): wire macos_ui_action approval integration tests into CI (signal #4) |
| task-l8eoxo92h | @link | feat(node): lane-template successor hook |
| task-w3fsz0cgj | @link | feat(node): calendar API — GET /calendar/upcoming, POST /calendar/events |
| task-0h8ppg8ia | @link | feat(node+cloud): POST /usage/ingest — accept external usage records |
| task-hsj337kch | @harmony | process: WORKFLOW-pr-review.md — PR review lifecycle template (create→review_requested→approve→handoff→complete) |
| task-f588zca23 | @harmony | process: SIGNAL-ROUTING-general-digest.md — routing proposal for #general noise reduction + suppression policy |
| task-64kyft4n2 | @rhythm | ops: self-propelling task templates — done criteria auto-generate next task |

### reflectt-cloud / app.reflectt.ai

| Task | Owner | Description |
|---|---|---|
| task-gum24x41y | @link | feat(cloud): canvas card visual spec implementation — onboarding + day-summary |
| task-g3doyrm9n | @pixel | design(cloud): canvas day-summary card renderer |
| task-6b5jkt0mg | @pixel | design(cloud): canvas step 2+3 onboarding — composer activation + first run |
| task-mfhuosflt | @artdirector | Art direction: canvas first-impression cards — onboarding + day-summary |
| task-ftedfmu98 | @uipolish | UI Polish: iOS presence view — spacing, typography, dark mode pass (#1175 merged) |

### iOS / Android

| Task | Owner | Description |
|---|---|---|
| task-nlhvyoxh3 | @kotlin | feat(android): push-to-talk voice input + voice playback parity with iOS |
| task-y0pu8aax6 | @kotlin | feat(ARCore): agent presence world anchors — tap/gaze interaction + world-space |
| PR #1005 | @link | feat(node): POST /usage/ingest — accept external usage from OpenClaw sessions (25 agents visible) |

### Ops / Process

| Task | Owner | Description |
|---|---|---|
| task-ajykmnag9 | @coo + @kai | COO EOD signal list: 7 events with root cause + patch candidates |
| task-ctme7ucaz | @kai | ops: redeploy all 3 hosts (Mac Daddy, BackOffice, EVI-Fly) to f4df59d3 — canvas approval emit live |
| task-564n3z3sp | @cos | decision log updated — key decisions from 2026-03-14 captured |
| SOUL.md patches | @harmony | Signals #1, #6, #7 committed as Non-Negotiable rules |

---

## What's Blocked

| Task | Owner | Blocker |
|---|---|---|
| task-1773447496113-9apcjk5nm (ANTHROPIC_API_KEY in prod) | @link | P1 — env var not set in production; blocks any Anthropic-model agent in prod. Needs @ryan or @kai to set in Vercel/host env. |
| task-1772920728052-hs6mv5ocs (cross-host context search) | @spark | P2 — blocked on cross-host API availability; @link's cross-host work is prerequisite. |
| task-1772920728025-93h8stvy0 (cross-fleet work routing) | @sage | P2 — blocked on multi-host registry; dependent on cloud connection being active. |

---

## Open Risks

### 1. Restart broadcast flood (mitigated, not resolved)
Rate-limit task shipped (task-6pyxtkuzt) but not yet deployed to all hosts. Between 05:24 and 08:33 PDT, reflectt-node restarted 5+ times within ~90 minutes, flooding #general and triggering false-idle watchdog escalations. This degraded coordination quality for ~3h.

**Status:** Code fix merged. Needs deploy to BackOffice + EVI-Fly (task-1773525654862 in progress).

### 2. Cross-host insight sync gap
Insights are node-local only. Agents on other hosts cannot see Mac Daddy insights without manual full-ID posting. Today cost ~15m of back-and-forth.

**Status:** Short-term mitigated (#1015 — host prefix in digests). Long-term: cloud sync needed.

### 3. Reflection gate staleness bug (recurring)
Reflection tracking row doesn't update correctly after multi-submission, blocking re-claim. Seen repeatedly across @harmony, @echo, @kai.

**Status:** task-pz1z8u0xo → @link, shipped today. Monitor for regression.

### 4. ANTHROPIC_API_KEY not in prod
Any agent configured to use Anthropic models in production will fail silently.

**Status:** P1 blocker, needs Ryan/Kai env config action. No ETA.

### 5. iOS release pipeline not started
P0 tasks exist (TestFlight, Apple Developer enrollment) but @swift queue has had restart churn today. No TestFlight build yet.

**Status:** Push-to-talk PR in validating (task-8k8bq5kon → @kai review). Ship path exists but no build yet.

---

## Signal Routing Status

Major output from today's process work:

- **`process/SIGNAL-ROUTING-general-digest.md`** — routing rules, suppression policy, named implementation owners
- **`process/WORKFLOW-pr-review.md`** — PR lifecycle template with restart continuity checks
- **SOUL.md patches** — chat approval ≠ formal close; qa_bundle must include content; restart survivability protocol

**Implementation tasks created from SIGNAL-ROUTING:**

| Signal | Task | Owner | Status |
|---|---|---|---|
| Restart broadcast rate-limit (#5) | task-6pyxtkuzt | @link | ✅ done |
| Stale task re-queue on restart (#2) | task-7e8j3tacp | @link | ✅ done |
| Reflection reminder tiers (Change 2) | task-1773525631162 | @link | todo |
| Batch-before-post for nags (Change 4) | task-1773525646527 | @link | todo |
| PR scope gate (#3) | task-4q3uyjwyo | @link | ✅ done |
| macos_ui_action CI gate (#4) | task-mfhuosflt | @link | ✅ done |

---

## Mobile Status (iOS / Android)

### iOS
- **Push-to-talk voice input:** In validating (task-8k8bq5kon), awaiting @kai review
- **TestFlight build:** Not yet. Blocked on push-to-talk merge + Apple Developer enrollment
- **Apple Developer enrollment:** P0, assigned @swift, todo
- **Widget extension:** P2, @swift, todo
- **UI Polish:** ✅ merged #1175 (spacing, typography, dark mode — @uipolish)

### Android
- **Push-to-talk + voice playback:** ✅ shipped (task-nlhvyoxh3, @kotlin)
- **ARCore agent presence world anchors:** ✅ shipped (task-y0pu8aax6, @kotlin)

---

## Team Energy Observations

- **High output** from @link today — 8+ tasks shipped, spanning node, cloud, ops, CI. No sign of fatigue.
- **@kotlin** is shipping fast and quietly (2 complex Android/ARCore tasks done today). Worth a check-in — good momentum, want to make sure they're not blocked on anything invisible.
- **Coordination friction** in the morning (restart flood + false-idle watchdog escalations) resolved by midday. Team handled ambiguity well.
- **Review queue** has 4 open items for @ryan and 1 for @kai. Ryan items may be stale — worth a review pass.
- **@swift** had a restart-heavy session and may be behind. iOS critical path (TestFlight) is at risk if push-to-talk review doesn't move today.

---

## Tomorrow's Focus (suggested)

1. **@kai:** Clear iOS review queue (push-to-talk in validating) — unblocks TestFlight path.
2. **@ryan:** ANTHROPIC_API_KEY in prod — unblocks P1 blocker.
3. **@link:** Deploy BackOffice + EVI-Fly to latest (task-1773525654862) — closes restart survivability gap.
4. **@link:** Reflection reminder tiers + batch-before-post (2 todo tasks) — completes signal routing implementation.
5. **@harmony:** Monitor team health post-restart-fix for 24h — confirm false-idle escalation rate drops.