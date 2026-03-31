# TASK-lam5hd11b — Cloud Onboarding Nudge: Activate Ghost Signups

**Author:** @funnel  
**Date:** 2026-03-16  
**Reviewer:** @pm  
**Source:** task-87vupfj7x (preflight→workspace_ready root cause analysis)

---

## Problem

8 of 12 signed-up users (67%) never ran `reflectt doctor` or triggered the preflight endpoint.  
These are **ghost signups** — they completed account creation but never started the node.

This is the **dominant activation gap** in the funnel today, upstream of everything else:
- Canvas discovery experiment targets post-workspace_ready users
- Continuity reflex loop targets post-workspace_ready stalls
- Both are irrelevant if users never get the node running

**Cannot be fixed server-side** — the node never runs, so server hooks never fire. Requires cloud-side intervention.

---

## Detection Logic

**Signal:** `signup_completed` event present, `host_preflight_passed` absent

**Timing:** Trigger nudge after **2 hours** of inactivity post-signup.

Rationale:
- 2h gives users who install immediately (the fast path) time to complete without being interrupted
- Short enough that users haven't fully churned — they still remember signing up
- Aligns with "same session" window; users who come back the next day are in a different mental state

**Implementation query (cloud-side):**
```sql
-- Users who signed up >2h ago with no preflight
SELECT user_id, signup_at
FROM activation_events
WHERE event_type = 'signup_completed'
  AND signup_at < NOW() - INTERVAL '2 hours'
  AND user_id NOT IN (
    SELECT user_id FROM activation_events
    WHERE event_type IN ('host_preflight_passed', 'host_preflight_failed')
  )
```

**Repeat nudge:** Once at 2h, once at 24h (email only), then suppress. Not a drip campaign.

**Escape hatch:** Suppress entirely after 7 days of no activity. Mark user as churned-pre-activation.

---

## Channel Decision: Both In-Dashboard + Email

**In-dashboard banner (2h trigger):**  
Best for users who return to the cloud app. High intent — they're actively looking at the product.  
Show on Overview/dashboard page only (not on every page — avoid annoyance).

**Email (24h trigger):**  
For users who haven't returned to the dashboard. One email, not a sequence.  
Subject line matters — this is the difference between 10% and 40% open rate.

---

## Copy

### In-Dashboard Banner

**Placement:** Top of Overview page, dismissable  
**Trigger:** 2h after signup with no preflight  

---

**Headline:** Your node isn't connected yet.

**Body:** reflectt-node runs on your machine (or a VPS). Once it's running, your agents come alive.

**CTA button:** `Get started → ` (links to GETTING-STARTED.md or inline install flow)

**Inline command block (copy/paste):**
```bash
# Takes ~2 minutes
npm install -g reflectt-node
reflectt init
reflectt start
```

**Sub-line:** Already installed? Run `reflectt doctor` to diagnose.

**Dismiss:** "I'll do this later" (suppresses banner for 24h)

---

### Email (24h)

**Subject:** Your AI team is ready — your node isn't (yet)

**Preview text:** One command to connect. Takes 2 minutes.

**Body:**

---
Hey —

You signed up for Reflectt yesterday but your node hasn't connected yet.

Your team is waiting. Here's all it takes:

```
npm install -g reflectt-node && reflectt init && reflectt start
```

Then open [your dashboard](https://app.reflectt.ai) and click Canvas. You'll see your agents as living orbs in a shared room.

If something's blocking you, run `reflectt doctor` — it'll tell you exactly what's wrong and how to fix it.

— The Reflectt team
```

**CTA button:** Connect my node →

---

**Tone rationale:** Direct, not apologetic. "Your team is waiting" frames the agents as real — sets up the canvas WOW moment before they even install. Short. No feature list.

---

## Success Metric

**Primary:** % of nudged users who fire `host_preflight_passed` within 24h of nudge delivery

**Target:** 30% conversion (nudge → preflight) — this would recover ~2-3 of the 8 ghost users per cohort

**Secondary:** `day2_return_action` rate among nudge-converted users vs non-nudged  
(measures whether the nudge pathway produces retained users or one-time visitors)

**Measurement:** Tag nudged users with metadata `nudge_source: 'ghost_signup_2h'` or `'ghost_signup_24h'` in their activation event so we can split the cohort.

---

## Escape Hatch

| Condition | Action |
|-----------|--------|
| User fires `host_preflight_passed` | Suppress all nudges immediately |
| 7 days post-signup, still no preflight | Mark `churned_pre_activation`, suppress permanently |
| User explicitly dismisses banner 3x | Suppress banner, still send 24h email once |
| User unsubscribes from email | Suppress email only, banner still shows |

---

## Implementation Notes for @pm / Cloud Team

1. **Cloud query:** Needs access to activation-funnel.jsonl data or equivalent cloud DB view
2. **Email sender:** Use existing transactional email infrastructure (Resend)  
3. **Nudge tag:** Add `nudge_cohort` field to activation event metadata when nudge fires so we can measure conversion
4. **Dashboard banner:** Needs a "dismissed" state per user stored in cloud (not localStorage — users switch devices)
5. **No server-side changes needed** — this is entirely a cloud app + email change

---

## Open Questions for @pm

1. Does the cloud app already track which users have connected a node? (If so, use that signal instead of the activation funnel query)
2. Is there an existing email sequence that this should slot into, or is it a standalone trigger?
3. Who owns cloud app banner UI — @uipolish or @link?
