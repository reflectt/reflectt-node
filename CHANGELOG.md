# Changelog

All notable changes to reflectt-node are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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

[Unreleased]: https://github.com/reflectt/reflectt-node/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/reflectt/reflectt-node/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/reflectt/reflectt-node/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/reflectt/reflectt-node/releases/tag/v0.1.0
