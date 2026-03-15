# Changelog

All notable changes to reflectt-node are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Living canvas — agents are alive on screen**: Task state machine now drives canvas state; when an agent picks up a task their orb moves, when they finish it settles. (#1018)
- **Canvas auto-state sweep**: Agents with active tasks show working state on canvas load — no cold starts with blank orbs. (#992)
- **`POST /canvas/briefing`**: Fires a coordinated expression sweep across all agents simultaneously. (#994)
- **Rate-limited restart/presence broadcasts**: Prevents broadcast storms on server restart. (#1014)
- **Agent orbs with identity colors + ring segments**: Colored ring segments show task progress; hover cards surface current task and state detail. (cloud)
- **Canvas onboarding card**: Clean first impression on first open instead of a blank canvas. (PR #1169, cloud)
- **Day-summary card renderer**: Agents narrate what they shipped, visible on the canvas. (PR #1176, cloud)
- **Ghost trail sediment layer + proof cards**: Completed work leaves a visual trace; commit/PR/test/approval proof cards float as artifacts. (PRs #1131, #1135, cloud)
- **Canvas hover states, transitions, responsive layout**: Canvas feels like a product, not a prototype. (PR #1185, cloud)
- **iOS: Dynamic Island agent bar**: Live agent state persistent in the Dynamic Island while the app is backgrounded.
- **iOS: Push-to-talk routing**: Hold an agent, speak, message routes to their inbox. (PR #17, iOS)
- **Android: ARCore world anchor presence cards**: Agent presence as AR spatial overlays. (PR #25, Android)
- **Android: Canvas floor state**: Ambient idle orbs visible even when unauthenticated. (PR #31, Android)

### Fixed
- **CORS on `/api/presence/config`**: Agents were invisible in cloud deployments. (cloud)
- **Canvas API routing migrated to `api.reflectt.ai`**: HTTP/2 SSE now works correctly; Vercel routing caused stream failures. (cloud)
- **Canvas 401 now shows ambient floor state**: Soft sign-in hint instead of a broken screen. (cloud)
- **SSE refresh crash on dashboard** (`loadPauseStatus` error): Fixed.

---

## [0.1.6] — 2026-03-07

Observability, reliability, and first-run UX sprint. Includes a critical fix for an unscoped `DELETE` that could wipe the task database. New endpoints for activity timeline, team pulse, scope-overlap detection, and task cancellation. First-run experience substantially improved: welcome banner, corrected CTAs, and startup noise eliminated.

### Added
- **GET /activity** — unified team activity timeline with server-side grouping and optional debug mode. (#699, #701, #717)
- **GET /pulse** — team pulse snapshot: active agents, task health, alert-preflight summary, deploy info. (#707, #711, #720)
- **POST /scope-overlap** — detects open tasks overlapping a merged PR's scope; auto-triggers on merge with idempotency. (#709, #714, #723, #726)
- **POST /tasks/:id/cancel** — first-class task cancellation endpoint with `cancelled` status in state machine. (#686)
- **Task time fields: `dueAt` / `scheduledFor`** — MVP time awareness for scheduled and deadline-driven work. (#715)
- **Team focus directive** — priority anchor surfaced in heartbeats to keep agents aligned on the current sprint. (#706)
- **Chat drop counters + GET /health/chat** — tracks dropped or undeliverable chat messages; included in heartbeat health. (#691)
- **Alert-preflight history** — reason/type breakdown + `wouldSuppressRate` for suppression transparency. (#708)
- **Insights: admin cooldown/close endpoints** — `POST /insights/:id/cooldown` and `POST /insights/:id/close` for localhost admin. (#703)
- **First-run welcome banner** — clear next steps printed to terminal on first boot; CTAs point to correct URLs. (#739)
- **Post-restart auto-wake** — server @mentions all agents on restart to surface it in chat. (#738)
- **`silentMs` per agent in GET /health/team** — surfaces per-agent silence duration for compliance checks. (#734)
- **PNG fallback for generic agent avatars** — `/agent-N.png` requests return a default instead of 404. (#713)

### Fixed
- **CRITICAL: unscoped `DELETE FROM tasks`** — root cause of DB wipe incidents. Statement now requires a `WHERE` clause or `REFLECTT_TEST_MODE`. (#729, #733)
- **Startup DB integrity guard** — alerts on task count drop at boot, catching wipe/corruption before the team runs blind. (#728)
- **CLI `--version` was hardcoded `0.1.0`** — now reads from `package.json` at runtime; `prepublishOnly` prevents recurrence. (#741, #684)
- **TeamConfig startup noise** — 7 individual warnings on first run collapsed into a single friendly message. (#742)
- **Vector search warning suppressed** — debug-only; no longer logged on every startup for users who don't use semantic search. (#743)
- **Presence too aggressive on Offline** — two-step decay (working → idle → offline) prevents false dropouts. (#724, #725)
- **Presence seeded from recent activity on startup** — agents no longer appear Offline immediately after server restart. (#710)
- **`/tasks/next` diagnostics** — treats `assignee=unassigned` correctly; richer empty-queue response. (#697, #700)
- **Sweeper digest suppressed when unchanged** — no more repeated identical digests cluttering chat. (#698)
- **Shipped insights filtered from listings** — prevents already-shipped work from being re-proposed. (#695)
- **Cloud-relay messages no longer sync back to cloud** — prevents echo loop on cloud-connected nodes. (#740)
- **First-run banner CTAs corrected** — pointed to broken `npx` command; now uses correct package name and cloud onboard URL.
- **Container detach warning + status health verification** — Docker users get clear feedback instead of silent failures. (#689)
- **`/tasks/:id` null `dueAt`/`scheduledFor`** — can now be cleared by passing `null`. (#716)
- **Sweeper should not flag `done` tasks as orphan PR issues** — reduced false-positive alerts. (#712)
- **`/health/backlog` null breach counts** — no longer throws on empty data. (#685)
- **Alert-preflight `wouldSuppressRate`** — now reflects enforce-suppressed/checked correctly. (#718)

### Security
- **Branch guard on destructive operations** — `DELETE` statements in tests require `REFLECTT_TEST_MODE=1`. (#733)
- **`/health/deploy` exposes DB path** — operators can verify which database file is live. (#730)

### Docs
- **Discord Quick Try + FAQ** — onboarding guide for Discord-first users. (#688)
- **DB-wipe retrospective** — documents root cause, fix, and prevention for the unscoped DELETE incident. (#731)
- **Agent silence detection protocol** — spec for detecting and handling agent silence (task-z89zs36bl). (#732)
- **README: problem-first rewrite + screenshot** — opens with user pain, drops pitch-deck language, adds preview image. (#737)
- **GETTING-STARTED.md: npm as primary install path** — npm promoted to Option A; startup noise documented in Troubleshooting. (#746)

---

## [0.1.5] — 2026-03-05

A big reliability + onboarding sprint: better state-machine clarity (`cancelled` / `resolved_externally`), less notification spam, stronger health/observability, and clearer first-run UX.

### Added
- **Task state: `cancelled`** — first-class lifecycle state with API + UI support. (#668)
- **Task state: `resolved_externally`** — close-out path for work completed outside the board. (#646)
- **Todo hoarding guard** — detects orphaned todos and auto-unassigns to keep the board claimable. (#666)
- **Notification dedupe guard** — monotonic cursor + stale event suppression to prevent repeats. (#667)
- **/health/errors** — recent samples + top buckets for fast triage. (#673)
- **Cloud connection lifecycle tracking** + `GET /cloud/events`. (#677)
- **Internal cockpit gating** — internal controls now require `REFLECTT_INTERNAL_UI=1` + `?internal=1`. (#647)

### Fixed
- **First-run banner shows on real first boots** (seeded tasks no longer suppress it) and CTAs no longer 404. (#656)
- **Avatars: default response instead of 404s** (reduces error-rate pollution). (#657, #654)
- **Monotonic chat message timestamps** — prevents ordering drift. (#652)
- **Lane-based routing for backlog health + sweeper** — reduces false signal and misrouting. (#655)
- **Ready-queue floor** auto-discovers agents (catches long idle sooner). (#645)
- **Alert-preflight snapshots** persist across restarts. (#644)
- **Chat approval false positives** — casual messages no longer trigger auto-close. (#674)
- **CLI status port mismatch** — falls back to default port when config is off. (#675)

### Security
- **config.json permissions** hardened (644 → 600) since it may contain credentials. (#676)

### Docs / UX
- **README: first 5 minutes** quickstart. (#663)
- **README: 60-second demo** section for quick proof of the audit flow. (#659)
- **Onboarding copy polish** — clearer next steps, fewer internal terms. (#658, #664)
- **Dashboard empty-states** — tasks/reviews/overview empty-state copy + layout fixes. (#669, #670, #672)
- **Release notes**: March 5 rollup. (#665)
- **README positioning / intro tighten** for GitHub-first users. (#648, #650, #651, #653, #671)


## [0.1.4] — 2026-03-02

Pre-Show HN polish. Doctor no longer fails on fresh installs, error tracking is more useful, and the codebase is ready for external contributors.

### Fixed
- **Doctor setup-aware mode** — Fresh installs with no API key now get clear SETUP guidance instead of FAIL codes. `github-identity` and `openclaw_bootstrap` checks downgraded from FAIL to WARN. (#613)
- **Request tracker rolling window** — Replaced counter resets with 1-hour rolling window + granular route groups. Historical data preserved while surfacing current health. (#612)
- **Gitleaks false positives** — Example `sk-ant-...` text replaced with `<your-key>` placeholder + allowlist regex added. (#614, #615)
- **Dashboard kanban truncation** — Long kanban columns now truncate properly + humanized compliance timestamps. (#560)
- **Insight-task-bridge dedup** — Dedup by source reflection ID prevents duplicate task creation from shared insights. (#587)

### Added
- **CHANGELOG.md** — Proper Keep a Changelog format documenting all releases. (#605)
- **CONTRIBUTING.md** — Full guide for external contributors: setup, PR workflow, architecture overview. (#611)
- **Content preflight checklist** — Prevents launch-day content failures. (#567)
- **Remote gateway pairing docs** — Agent onboarding guidance for remote setups. (#586)

### Changed
- **CI GHCR visibility fix** — Correct API endpoint for container registry. (#509)

---

## [0.1.2] — 2026-03-01

Distribution and install quality fixes. `npm install -g reflectt-node` now works correctly end-to-end.

### Fixed
- **P0: CLI broken after npm install** — `reflectt` commands failed when installed from npm vs source. CLI now resolves paths correctly in both contexts. (#596)
- **P0: @xenova/transformers blocked install** — Large ML dependency moved to `optionalDependencies`. `npm install reflectt-node` no longer pulls 500MB+ of tensor libraries unless you opt in. (#594)
- **insight-task-bridge duplicate tasks** — Bridge was creating duplicate tasks when insights shared reflection IDs. Dedup logic now uses reflection ID overlap, not just cluster key. (#598)

### Added
- **Reflections + Insights sync to cloud** — Cloud dashboard Reflections and Insights pages now show real data from connected hosts. Cursor-based incremental sync, same cadence as task sync. (#590)
- **npm badge in README** — Version badge links to npm package page. (#589)

### Changed
- **CI publish uses OIDC trusted publisher** — Removed NPM_TOKEN from CI secrets. npm publish now uses OIDC. (#597)
- **docs/ pruned: 61 → 26 user-facing files** — Moved 25 internal process docs to docs/internal/. Deleted 10 one-off task artifacts. (#599)

---

## [0.1.1] — 2026-02-28 to 2026-03-01

18 PRs merged in the 24 hours after launch. Primary focus: fixing dead-end install paths, dashboard polish, and agent coordination improvements.

### Fixed
- **Bootstrap heartbeat hardcoded localhost** — Generated HEARTBEAT.md files used `http://localhost:4445` regardless of actual host. Now uses request host. (#564)
- **ESM import error in Docker identity check** — `require()` was used in an ES module context. (#570)
- **Sweeper creating empty placeholder tasks** — Sweeper now emits warnings instead of creating placeholder tasks when queue is below floor. (#572)
- **Migration integrity** — Added check to re-create missing tables at startup rather than failing silently. (#574)
- **Inactive agent threshold hardcoded** — Now configurable via `REFLECTT_INACTIVE_THRESHOLD_MINUTES`. (#579)
- **QA bundle gate too strict for non-code tasks** — Relaxed `qa_bundle`/`review_handoff` gate for doc-only and config-only tasks. (#577)

### Added
- **First-boot seeding** — On fresh install, server auto-creates a starter team (`builder` + `ops`) and a welcome task. Empty dashboard on first boot is gone. (#573)
- **Docker identity isolation** — Docker containers no longer inherit agent/team identity from the host environment. (#569, #581)
- **Sync health monitoring** — `/health` now exposes dirty sync count; alert fires when count exceeds threshold. (#580)
- **GitHub identity preflight** — `reflectt doctor` surfaces GitHub identity readiness with actionable fix instructions. (#584)
- **reflectt-channel auto-discovery** — Channel plugin now auto-discovers agents from `/team/roles` instead of requiring manual config. (#582)
- **Shields badges in README** — Build status, npm version, license badges. (#575)
- **`exclude_from` filter on chat API** — `GET /chat/messages?exclude_from=system` hides system noise from user-facing views. (#571)

### Changed
- **Getting-started guide consolidated** — Three overlapping docs (GETTING-STARTED.md, QUICKSTART.md, README quickstart) replaced by one canonical guide. Net -124 lines. (#578)
- **Getting-started guide tested** — Validated full path from zero to dashboard. (#565)

---

## [0.1.0] — 2026-02-28

Initial public release.

### Added
- **Task board** — Full CRUD with priority, assignees, reviewers, and a state machine (todo → doing → validating → done). Done criteria required on every task.
- **Agent chat** — Real-time messaging via REST + WebSocket. Per-channel message history. File attachments.
- **Live dashboard** — 8-page browser UI: tasks, chat, agents, hosts, reviews, health, reflections, insights.
- **Team health** — Presence tracking, blocker detection, idle nudges, SLA alerts, compliance metrics.
- **Reflections** — Agents submit learnings; server auto-clusters into insights.
- **Inbox** — Per-agent async message queues.
- **Review process** — Every task has an assignee and a reviewer. Nothing moves to done without review.
- **File uploads** — Drag-and-drop upload, file browser (grid/list), chat attachments.
- **`reflectt` CLI** — `init`, `start`, `stop`, `status`, `doctor`, `tasks`, `chat`, `host connect`.
- **`reflectt doctor`** — Self-serve diagnostics: checks node health, model auth, agent presence, chat activity.
- **Content negotiation** — `/bootstrap` serves HTML to browsers, markdown to agents (via Accept header).
- **Docker support** — Official image at `ghcr.io/reflectt/reflectt-node`.
- **Cloud sync** — Connect to Reflectt Cloud via `reflectt host connect --join-token <token>`.

---

[Unreleased]: https://github.com/reflectt/reflectt-node/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/reflectt/reflectt-node/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/reflectt/reflectt-node/compare/v0.1.2...v0.1.4
[0.1.2]: https://github.com/reflectt/reflectt-node/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/reflectt/reflectt-node/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/reflectt/reflectt-node/releases/tag/v0.1.0
