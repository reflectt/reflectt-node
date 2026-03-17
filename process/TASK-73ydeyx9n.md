# TASK-73ydeyx9n — Cloud Onboarding: Require reflectt doctor Before workspace-ready

**Author:** @funnel  
**Date:** 2026-03-16  
**Reviewer:** @pm  
**Source:** task-87vupfj7x (preflight root cause analysis)

---

## Problem

BYOH (Bring Your Own Host) onboarding currently shows:
```bash
npm install -g reflectt-node
reflectt init
reflectt start
```

There is no `reflectt doctor` step. 8/12 signed-up users never ran the node — most likely because they hit a silent setup failure (wrong Node version, port conflict, etc.) with no guidance on how to diagnose or fix it.

`reflectt doctor` solves this: it runs all preflight checks and gives actionable error output. Making it a **visible, required step** in the onboarding UI is the primary lever for the no_preflight_run gap.

---

## What Changes

### BYOH Onboarding Flow (after this change)

**Before:**
1. Install: `npm install -g reflectt-node`
2. Init: `reflectt init`
3. Start: `reflectt start`
4. Connect: paste join token

**After:**
1. Install: `npm install -g reflectt-node`
2. Init: `reflectt init`
3. Start: `reflectt start`
4. **→ NEW: Verify: `reflectt doctor` (required gate)**
5. Connect: paste join token (enabled only after doctor passes)

---

## Cloud UI Spec

### Step 4 UI: Doctor Gate

**Heading:** Verify your setup

**Body copy:**
> Before connecting, run one command to verify your node is ready:
>
> ```bash
> reflectt doctor
> ```
>
> This checks your Node version, port availability, network, and auth. Takes about 5 seconds.

**Status states:**

| State | UI | Action |
|-------|----|--------|
| Waiting | "Waiting for doctor check…" + spinner | Poll every 5s |
| Passed | ✅ "All checks passed — your node is ready" | Enable "Connect to cloud" button |
| Failed | ❌ "One or more checks failed" + failure reasons | Show fix guidance, keep polling for retry |
| Timeout (10m) | "Taking longer than expected" | Show manual skip option (with warning) |

**Skip option:** Allow with warning — "Skipping may cause connection issues. You can always run `reflectt doctor` later." Do NOT make skip the default path.

---

## Server-Side API (already available)

### Check doctor pass status for a user

```
GET /activation/funnel?userId=<userId>
```

Response field to check: `funnel.events.host_preflight_passed` — non-null = passed.

### Dedicated doctor gate endpoint (added in this PR)

```
GET /activation/doctor-gate?userId=<userId>
```

Simpler response optimized for polling:
```json
{
  "userId": "user-123",
  "passed": true,
  "passedAt": 1773709000000,
  "failureReasons": [],
  "workspaceReady": true
}
```

`failureReasons` is populated from `host_preflight_failed` event metadata if the user attempted but failed.

---

## Polling Strategy (Cloud UI)

```javascript
// Poll every 5 seconds for up to 10 minutes
async function pollDoctorGate(userId, joinToken) {
  const MAX_POLLS = 120 // 10 min at 5s interval
  for (let i = 0; i < MAX_POLLS; i++) {
    const resp = await fetch(`/activation/doctor-gate?userId=${userId}`)
    const { passed, failureReasons } = await resp.json()
    if (passed) return { passed: true }
    if (failureReasons.length > 0) {
      showFailureGuidance(failureReasons) // Show actionable help
    }
    await sleep(5000)
  }
  return { passed: false, timedOut: true }
}
```

---

## Failure Guidance Copy

Surface these for common failure reasons:

| Failure reason | Copy |
|----------------|------|
| `node_version` | Your Node.js version is too old. Run `node --version` — you need v18 or higher. Install the latest at nodejs.org. |
| `port_in_use` | Port 4445 is already in use. Run `reflectt start --port 4446` to use an alternate port. |
| `cloud_unreachable` | Can't reach Reflectt Cloud. Check your internet connection and try again. |
| `auth_failed` | Your join token may be expired. Go back and generate a new one. |
| Generic/unspecified | Something didn't pass. Run `reflectt doctor` in your terminal and check the output for details. |

---

## Success Metric

- **Primary:** `no_preflight_run` rate in activation funnel drops from 67% (8/12) toward <20%
- **Secondary:** `preflight_passed → workspace_ready` conversion (already ~100% post PR #1105) stays high
- **Measurement:** `GET /activation/funnel/failures` — watch `no_preflight_run` count per new-signup cohort

---

## Implementation Notes

**Cloud team (@link):**
- BYOH onboarding wizard step 4 UI (see spec above)
- Polling implementation (every 5s, 10min timeout)
- Failure guidance copy per reason code
- "Connect to cloud" button gated on `passed: true`

**Node (this PR):**
- `GET /activation/doctor-gate?userId=<userId>` — polling-optimized endpoint
- CLOUD_PROVISIONING.md updated with new BYOH flow

**No new events needed** — uses existing `host_preflight_passed` / `host_preflight_failed` events from preflight.ts.
