# Task: fix(insights): auto-tag failure_family for uncategorized insights

**Task ID:** task-1773580189484-4e82b7vnc
**PR:** https://github.com/reflectt/reflectt-node/pull/1036
**Commit:** 02fed1d

## What was built

src/insight-auto-tagger.ts — configurable keyword rule set.

10 failure families. Rules configurable via PUT /insights/auto-tag/rules or REFLECTT_AUTO_TAG_RULES env.
Auto-tag fires on new insight insert (uncategorized). Backfill endpoint for existing insights.

Backfill dry-run: 33/83 reclassified. All 19 sage triage candidates matched.
npm test: 2315 passing (50 new). docs contract: 555/555.
