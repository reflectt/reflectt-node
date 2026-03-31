# UTM Taxonomy v1 — reflectt-node Distribution

All outreach from reflectt-node / reflectt.ai agents should use these canonical UTM parameters. Consistent attribution lets us measure which channels drive installs and engagement.

## Parameters

| Parameter | Purpose | Required |
|-----------|---------|----------|
| `utm_source` | Where the link appears (platform) | ✅ |
| `utm_medium` | Type of distribution | ✅ |
| `utm_term` | Topic/angle of the content | ✅ |
| `utm_campaign` | Campaign batch (for grouping) | ✅ |

---

## Canonical Values

### `utm_source`

| Value | Use for |
|-------|---------|
| `hackernews` | Hacker News (⚠️ do not post — banned) |
| `reddit` | Any Reddit post or comment |
| `devto` | Dev.to articles |
| `discord` | Discord server posts |
| `x` | X (Twitter) replies and posts |
| `email` | Email / DM outreach |
| `github` | GitHub issues, discussions, READMEs |
| `linkedin` | LinkedIn posts |

### `utm_medium`

| Value | Use for |
|-------|---------|
| `community` | Forum posts, Discord, Reddit |
| `article` | Long-form blog / Dev.to |
| `show_hn` | Hacker News Show HN (⚠️ banned) |
| `reply` | Replies to existing threads/posts |
| `dm` | Direct message outreach |
| `social` | X / LinkedIn organic posts |
| `referral` | Inbound links from third-party content |

### `utm_term`

| Value | Use for |
|-------|---------|
| `agentic-team-coordination` | Main angle: coordinating agent teams |
| `ml-coordination-insights` | Research/ML audience angle |
| `multi-agent-orchestration` | Orchestration/framework audience |
| `open-source-agent-infra` | Open-source angle |
| `vibe-coding-coordination` | Vibe coding / indie builder audience |

### `utm_campaign`

| Value | Use for |
|-------|---------|
| `community-seed` | First wave of community outreach (Mar 2026) |
| `x-replies-march` | X reply cadence March 2026 |
| `launch` | Product launch campaigns |

---

## Canonical Link Format

```
https://github.com/reflectt/reflectt-node?utm_source=<source>&utm_medium=<medium>&utm_term=<term>&utm_campaign=<campaign>
```

## Active Campaigns

### community-seed (launched 2026-03-09)

| Channel | URL | Status |
|---------|-----|--------|
| Dev.to article | https://dev.to/seakai/how-we-coordinate-9-ai-agents-shipping-a-real-product-with-code-3227 | ✅ Live |
| Discord (OpenClaw #show-and-tell) | pending channel ID | ⏳ Pending |
| r/LocalLLaMA | pending credentials | ⏳ Pending |
| r/MachineLearning | pending credentials | ⏳ Pending |

### x-replies-march (ready to fire)

15 reply targets drafted in `docs/OUTREACH.md`. Pre-flight: verify handles before posting.

---

## Rules

1. **Always include all 4 params** — partial UTMs make attribution unreliable.
2. **Use the canonical repo README as the default landing** — not deep docs links (unless the person explicitly asked for depth).
3. **Non-dev / "just show me" option:** `https://app.reflectt.ai/bootstrap` — use for non-technical audiences.
4. **HN is off-limits** — do not post, do not suggest.
5. **No Reddit without credentials** — posts require authenticated API access. File as infrastructure gap if unresolved.
6. **X replies require handle verification** — search-sourced handles must be spot-checked before firing.

---

## Related Docs

- `docs/OUTREACH.md` — X + DM templates with canonical CTAs
- `kindling-x-replies-2026-03-09-v2.md` (workspace) — 15 X reply drafts
- `kindling-community-threads-2026-03-09.md` (workspace) — community thread drafts
