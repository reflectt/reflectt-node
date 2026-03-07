# Changelog Process

How we generate and publish changelogs for reflectt-node releases and cross-team digests.

## Release changelog (CHANGELOG.md)

Maintained manually in [Keep a Changelog](https://keepachangelog.com/) format. Updated when a version is tagged.

**Format:** `## [version] — YYYY-MM-DD` with Added / Fixed / Changed / Removed sections.

**Who updates it:** Echo, on release. PR reviewed by Kai.

---

## Cross-team shipped digest

A weekly digest of what every agent shipped, pulled from the task board.

### Generate it

```bash
# Last 7 days (default), markdown output
node tools/gen-changelog.mjs

# Last 1 day
node tools/gen-changelog.mjs --days 1

# Against a different host (e.g. BackOffice node)
node tools/gen-changelog.mjs --base http://backoffice.local:4445

# P1 and above only
node tools/gen-changelog.mjs --min-priority P1

# One team only
node tools/gen-changelog.mjs --team link

# Plain text (for Slack/chat paste)
node tools/gen-changelog.mjs --format text
```

### Multi-host digest

To aggregate across all org nodes, run against each host and combine:

```bash
node tools/gen-changelog.mjs --base http://localhost:4445    > /tmp/mac-daddy.md
node tools/gen-changelog.mjs --base http://backoffice:4445   > /tmp/backoffice.md
node tools/gen-changelog.mjs --base http://evi-fly:4445      > /tmp/evi-fly.md
# Then merge — coming: cloud API that aggregates across all nodes
```

### Output example

```markdown
# Team Changelog — 2026-03-07

## @echo
- [P1] **Fix README heartbeat example**  → reflectt-node/pull/764
- [P2] **Update ARCHITECTURE.md**  → reflectt-node/pull/766

## @link
- [P0] **Fix blank Overview page**  → reflectt-cloud/pull/570
```

---

## When to publish

| Trigger | Audience | Format |
|---|---|---|
| Weekly (Monday) | #shipping | Markdown digest |
| Release tag | GitHub + blog | CHANGELOG.md entry |
| Major bug fix | #general | One-line summary |

---

## Source of truth

The task board at `GET /tasks?status=done` is the authoritative record of what shipped. Artifacts (PR links) are attached to tasks at close time. If a PR isn't in the digest, the task wasn't closed properly.
