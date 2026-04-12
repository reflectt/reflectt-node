# Local-Only Customer Journey Checklist — 2-Day Freeze
**Author:** kindling
**Date:** 2026-03-30
**Purpose:** Operational runbook for the team during the 2-day prod freeze
**Reviewer:** @sage

---

## Valid Local Stack Paths

| Port | Service | URL | Status |
|------|---------|-----|--------|
| 3100 | Web UI (Reflectt app) | http://localhost:3100 | ✅ Valid proof path |
| 13000 | API (Reflectt Node) | http://localhost:13000 | ✅ Valid proof path |
| 3001 | Alt API | http://localhost:3001 | ✅ Valid proof path |
| 24000 | managed-test reflectt-node | http://localhost:24000 | ✅ Valid proof path |
| 24001 | managed OpenClaw | http://localhost:24001 | ✅ Valid proof path |

### Invalid Proof Paths (Do NOT use)

- ❌ Port 4445 — internal task API, not customer-facing
- ❌ Production — off-limits during freeze
- ❌ Mocks — not real customer journey
- ❌ Seeded agents — not a fresh customer

---

## Fresh Customer Journey Steps

1. **Signup** — Navigate to http://localhost:3100, create a new account
2. **Onboard** — Complete onboarding flow, verify email if required
3. **Team provisions** — A managed team should provision automatically upon signup
4. **Team wakes up on canvas** — Navigate to canvas view, verify managed team agents appear

---

## PASS Criteria

The checklist is PASS when these are all visible and functional:

- ✅ **Avatars visible** — Team agent avatars appear on canvas
- ✅ **Avatars clickable** — Clicking an avatar shows agent details/status
- ✅ **Tabs** — Canvas has working tabs (e.g., Tasks, Agents, Team)
- ✅ **Composer** — Message composer is visible and functional
- ✅ **Reload** — Page reload maintains state (no crash on refresh)

---

## Invalid Proof Indicators (FAIL if observed)

- ❌ No avatars on canvas after fresh signup
- ❌ "No agents" state after team provisioning
- ❌ Clicking avatar does nothing or errors
- ❌ Tabs are missing or non-functional
- ❌ Composer missing from canvas view
- ❌ Page crash or blank screen on reload

---

## Usage

**Who uses this:** @rhythm, @sage, @pixel during the 2-day freeze

**When to run:** After any local stack restart, or before any customer-facing demo

**What to report:** Pass/Fail for each PASS criterion. If FAIL, note which step failed and what you observed.

---

## Quick Reference

```
Valid stack: 3100, 13000, 3001, 24000, 24001
Invalid: 4445, prod, mocks, seeded agents

Journey: signup → onboard → team provisions → canvas wake-up

PASS: avatars visible + clickable, tabs work, composer works, reload survives
```

