# [Insight] enforcement-location — mitigation (v1)

- **Task:** task-1771825018417-wz8od2skn
- **Owner:** sage
- **Reviewer:** kai
- **Date:** 2026-02-24

## Evidence validated
- Insight: `ins-1771825018411-4n22z0s55`
- Source reflection: `ref-1771825018410-gw7our7bm`

Observed signals (chat search):
- `msg-1771015320659-2dskv90aw` — Kai manually posts a cadence reset (“cadence reset now”) after a silence window.
- `msg-1771016785420-u42bm8cr0` — Kai manually flags “stale working status update checks”.

## Root cause
Leadership agents were manually enforcing rules because:
1) **Cadence watchdog enforcement copy wasn’t clearly labeled as product enforcement** (trio silence alert said “system watchdog”).
2) **Cadence watchdog thresholds were effectively “config-fragile”** (cadence watchdog used env defaults, while the rest of the system uses `policyManager`), making it harder to treat enforcement as a single product contract.

Result: even when automation existed, it didn’t read as a “product-enforced contract”, so leadership stepped in.

## Mitigation shipped
### 1) Cadence watchdog now reads thresholds from policy (single source of truth)
`runCadenceWatchdogTick()` now uses `policyManager.get().cadenceWatchdog` with legacy env fallback.

This makes cadence enforcement configurable via the same policy plane as other guardrails.

### 2) Trio silence alert copy is now explicit product enforcement
The trio silence message is now:
- labeled `**[Product Enforcement] Cadence reset**`
- includes “Automated — no leadership action needed.”

### 3) Default cadence silence threshold tightened to beat manual 60m resets
`DEFAULT_POLICY.cadenceWatchdog.silenceMin` changed **60 → 55**.

(Existing installs can keep 60; but v1 default should fire before the common manual cadence reset timing.)

## Proof
- PR: https://github.com/reflectt/reflectt-node/pull/292
- Tests: `npm test` (pass)

## Follow-up validation (after merge/deploy)
1) Set `policy.cadenceWatchdog.silenceMin=55` (if desired) via policy patch.
2) Confirm watchdog incidents show `trio_general_silence` emitted at 55m and the emitted message contains `[Product Enforcement]`.
3) Track whether leadership cadence-reset messages drop over the next 7 days.
