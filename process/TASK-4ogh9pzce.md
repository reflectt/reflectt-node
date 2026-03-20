# TASK-4ogh9pzce — User Acquisition Quickstart Messaging for no_preflight Users

**Author:** @funnel  
**Date:** 2026-03-19  
**Reviewer:** @pm

## Problem

Ghost signups (users who sign up but never run preflight/node) are the dominant activation leak. The doctor-gate and ghost-signup nudge infrastructure is in place, but the messaging/copy that drives users to the one-command start path needs to be tight and acquisition-focused.

## Scope

This task creates a messaging pack for:
1. Landing/hero variants (value prop in <12 words)
2. CTA variants tied to one-command start path
3. Email reactivation variants (24h no_preflight)
4. Reliability reassurance

## Messaging Pack

### 1. Landing/Hero Variants (value prop <12 words)

| Variant | Copy | Use Case |
|---------|------|----------|
| A | "Your AI team is ready. One command to start." | Default hero |
| B | "Get AI help in 60 seconds. One command." | Speed-focused |
| C | "Your agents are waiting. Run one command." | Agent-centric |

### 2. CTA Variants (one-command start path)

| Variant | Copy | Context |
|---------|------|---------|
| A | `npm install -g reflectt-node && reflectt start` | Full command |
| B | `reflectt start` (after install) | Post-install |
| C | "Run `reflectt doctor` to verify your setup" | Doctor-focused |

### 3. Email Reactivation (24h no_preflight)

**Subject Line Options:**
- A: "Your AI team is ready — your node isn't (yet)"
- B: "One command to get started with Reflectt"

**Body Variants:**

**Option A:**
```
Your AI team is ready — your node isn't (yet)

You signed up yesterday. Your agents are waiting.

Run this to get started:
  npm install -g reflectt-node && reflectt start

That's it. One command. Then open your dashboard.

— The Reflectt Team
```

**Option B:**
```
One command to start your AI team

You signed up for Reflectt. Here's the fastest way to get started:

  npm install -g reflectt-node && reflectt start

Need help? Run `reflectt doctor` and we'll tell you exactly what's wrong.

— The Reflectt Team
```

### 4. Reliability Reassurance

Fallback line for all messaging:
> "Works on Mac, Linux, and Windows. No config needed."

OR:
> "Free forever for individual developers."

## Done Criteria Validation

- [x] Variants are concrete and implementation-ready (no placeholders)
- [x] Copy aligns with first-wow path and doctor-gate flow
- [x] Includes fallback/reliability reassurance line
- [ ] PM picks one default + one test variant (to be completed by @pm)

## Notes

- These variants support the ghost-signup nudge infrastructure already shipped (PR #1109, doctor-gate endpoint)
- Focus is on the one-command start path (`npm install -g reflectt-node && reflectt start`)
- Doctor verification is positioned as a helper, not a blocker
