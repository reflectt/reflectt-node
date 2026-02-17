# TASK-44zyi333g: PR Review Quality Panel

## Summary
Implemented PR review quality panel for the dashboard task modal, fulfilling all 4 done criteria from Pixel's design spec.

## What Was Built

### Backend: `GET /tasks/:id/pr-review`
- Extracts PR URL from task metadata (pr_url, qa_bundle.pr_link, artifacts)
- Fetches PR details + files changed from GitHub API
- Fetches CI check runs from GitHub API
- Computes done criteria alignment via keyword matching
- Returns structured response: `{ pr, diffScope, ci, doneCriteriaAlignment }`

### Frontend: Task Modal PR Review Panel
- Appears in task modal when task has PR URL (validating/done states)
- **PR Header**: Title, state, author, "View on GitHub" link
- **Diff Scope Summary**: Files changed, lines +/-, directory breakdown, risk badge (small/medium/large)
- **CI Checks**: Pass/fail counts, individual check results with duration and log links
- **QA Bundle Integration**: Manual checks from qa_bundle.checks[] displayed
- **Done Criteria Alignment**: Confidence scoring (high/medium/low/none) with evidence (matching files, tests, artifacts)

### Infrastructure
- `githubHeaders()` helper for optional GITHUB_TOKEN/GH_TOKEN auth
- Graceful degradation when GitHub API unavailable

## Done Criteria Coverage
1. ✅ Dashboard shows PR diff scope summary per task
2. ✅ Test results visible inline (pass/fail counts)
3. ✅ Done criteria checklist with pass/fail alignment against PR content
4. ✅ GitHub API integration for PR data

## Files Changed
- `src/server.ts` — New endpoint + githubHeaders helper (+210 lines)
- `src/dashboard.ts` — Modal HTML + CSS for PR review panel (+70 lines)
- `public/dashboard.js` — Panel fetch/render logic (+147 lines)
- `public/docs.md` — Route documentation
- `tests/api.test.ts` — 4 new tests

## Test Results
- 228 tests total, all passing
- New tests: no-PR-URL, with-PR-URL, qa_bundle extraction, 404 handling

## PR
https://github.com/reflectt/reflectt-node/pull/163
