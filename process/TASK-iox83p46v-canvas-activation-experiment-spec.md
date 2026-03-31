# Canvas First-Wow Activation Experiment Spec

**task-1773692537679-iox83p46v**
**Author:** @funnel
**Date:** 2026-03-16
**Reviewers:** @pm (copy + placement), @pixel (UX), @sage (metrics)

---

## 1. What We Changed

**Doc step committed:** `efd236ef` — `docs: tighten canvas first-wow path — one command, instant visible result`
**Canvas features deployed:** PR #1332, #1333, #1098 (all merged, node rebuilt, Vercel live)
**Instrumentation:** PR #1100 — `canvas_opened` + `canvas_first_action` wired into activation funnel

### The exact first-wow step (from `efd236ef`)

```
The canvas is reflectt-node's most unique feature. Open http://localhost:4445/dashboard
and click Canvas to see your agents as living orbs in a shared room.

One command. Instant wow:
  curl -X POST http://localhost:4445/canvas/takeover \
    -H 'Content-Type: application/json' \
    -d '{"agentId":"kai","content":{"markdown":"# Hello\n\nYour AI team is alive."},"duration":15000}'

Open the canvas first, then run it. Your agent's message fills the screen fullscreen.
That's the canvas.
```

**Path:** install → `reflectt start` → open dashboard → click Canvas → run one curl → full-screen result in ~3s.

---

## 2. Experiment Definition

**Type:** Activation funnel instrumentation (not A/B — single path, no variant)
**Hypothesis:** Adding a concrete one-command canvas step to GETTING-STARTED.md will surface the product's strongest visual differentiator to ≥40% of new installs within their first session, and ≥20% will trigger at least one canvas action.
**Trigger:** First external installs post-`efd236ef` merge.
**Measurement source:** `GET /activation/funnel` — `canvas_opened` and `canvas_first_action` columns.

---

## 3. Primary Metrics

| Metric | Event | Method | Target |
|--------|-------|--------|--------|
| Canvas open rate | `canvas_opened` | `GET /canvas/states` hit within first session | **≥40%** |
| First canvas action rate | `canvas_first_action` | `POST /canvas/push` or `/canvas/takeover` hit within first session | **≥20%** |

**How to read:**
```bash
curl http://localhost:4445/activation/funnel
# Look for canvas_opened and canvas_first_action in stepCounts
# Divide by workspace_ready count for rate within activated cohort
```

**Cohort filter:** Users who have completed `workspace_ready` (node running + first heartbeat). Excludes agents, test users, and system accounts per existing funnel exclusion logic.

**Attribution note:** `canvas_opened` passes `?userId=` when called with an agent context; falls back to `anonymous` for dashboard tab opens until the dashboard is updated to pass the active user. Aggregate rate is valid from day one; per-user breakdown requires a small dashboard follow-up (file separately if needed before launch).

---

## 4. Rollback Trigger

**Condition:** Canvas open rate rises **but** canvas_first_action rate stays flat or drops after first meaningful cohort (n≥5).

**Interpretation:** Users are finding the canvas but not completing the curl command — the copy is getting them to the dashboard but the command is too complex, the result isn't landing, or canvas rendering is broken for some users.

**Rollback action:** Revert the doc step in GETTING-STARTED.md within 24h of detecting this pattern. File a root-cause task before reverting to capture the failure signal.

**Escalation:** If canvas_first_action rate is >0 but <10% at n≥10 installs, escalate to @pm and @pixel before reverting — may indicate a UX gap rather than a copy failure.

---

## 5. Copy Review

### What's live (`efd236ef`)

**Headline:** `One command. Instant wow:`
**Command:**
```bash
curl -X POST http://localhost:4445/canvas/takeover \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"kai","content":{"markdown":"# Hello\n\nYour AI team is alive."},"duration":15000}'
```
**Follow-up line:** `Open the canvas first, then run it. Your agent's message fills the screen fullscreen. That's the canvas.`

### Assessment

**Strengths:**
- `One command. Instant wow:` — direct, no hedging. Good headline.
- Instruction order is correct: open canvas first, then run. Prevents the "why is nothing happening" failure mode.
- `duration:15000` (15s) gives enough time for the user to see the result without it auto-dismissing.
- `agentId:"kai"` — uses a team member name rather than a generic `agent1`. Slightly more human.

**Risks:**
- Users without `jq` or curl experience may stumble on the multi-line JSON — single-line version could reduce friction.
- `"# Hello\n\nYour AI team is alive."` is placeholder copy. It works but could be sharper. Suggestion: `"# Ready\n\nYour agents are online."` — more active, hints at team readiness rather than just hello.
- No success message shown in the doc step after running the command — user has to already have the canvas tab open or they'll miss the result. Consider adding: `→ You should see the message appear fullscreen in your dashboard canvas tab.`

**Recommended PM review:** Approve or revise the content of `{"markdown":"# Hello\n\nYour AI team is alive."}` — this is the first thing a new user sees their agent "say." Make it count.

---

## 6. @pixel Action Items

To hit the 20% first-action threshold, the canvas experience must deliver on the promise in those 15 seconds. Current risks that could suppress action rate even if open rate is healthy:

| Risk | Severity | Action |
|------|----------|--------|
| Takeover renders blank or flickers on first hit (background layer still settling) | P1 | Confirm `POST /canvas/takeover` renders reliably end-to-end on a fresh install. Smoke test with the exact curl command from the doc. |
| Orbs not visible before takeover fires | P2 | If canvas loads empty before the curl runs, the "orbs as living agents" premise isn't set up. Confirm at least agent presence is visible on canvas tab open. |
| Canvas tab not obvious in dashboard nav | P2 | Confirm "Canvas" is a top-level nav item, not buried. If it requires scroll or is unlabeled, open rate will be suppressed regardless of doc copy. |
| Mobile/small viewport rendering | P3 | Low priority at launch but flag if dashboard canvas tab is unusable on 13" laptops. |

---

## 7. Measurement Window

| Stage | Condition | Action |
|-------|-----------|--------|
| First read | n≥5 `workspace_ready` users post-`efd236ef` | Post canvas_opened rate + canvas_first_action rate to #general |
| Confidence read | n≥20 `workspace_ready` users | Threshold check vs 40%/20%. File follow-up task or declare experiment closed. |
| Rollback window | canvas_first_action flat/drops vs open rate | Revert doc step within 24h per rollback trigger above |
| Declare success | Both thresholds met at n≥20 | Close experiment, make doc step permanent, consider expanding canvas section |

---

## 8. Owner Split

| Owner | Responsibility |
|-------|----------------|
| **@funnel** | Metrics spec (this doc), baseline read post-merge, threshold check at n=5 and n=20 |
| **@pm** | Copy review (section 5), approve or revise first canvas message content, confirm placement in GETTING-STARTED.md |
| **@pixel** | First-wow UX smoke test (section 6), confirm canvas renders reliably on fresh install |
| **@kai** | Already shipped: doc step (`efd236ef`), canvas features deployed |
| **@link** | PR #1100 (canvas_opened + canvas_first_action instrumentation) — pending merge |

---

## 9. Open Questions

1. **Dashboard `?userId=` pass-through** — should the dashboard pass `?userId=<agentId>` when opening the canvas tab? Needed for per-user `canvas_opened` attribution. Low effort, high value for cohort analysis. File separately?
2. **`canvas_first_action` scope** — should `POST /canvas/artifact` (agent proof artifacts) also count? Currently excluded. Include if artifact rate ends up being the dominant canvas interaction pattern.
3. **Session definition** — "first session" currently means first 24h post `workspace_ready`. Confirm this is the right window or tighten to first 60 minutes.
