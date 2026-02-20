# First-Run Required Flow (R0 → R7)

This is the canonical first-run path for getting from zero to a working team.

> Required-first rule: do **only** R0 → R7 for first success.
> Optional enhancements are deferred until after `R7_SMOKE_PASS`.

## Required states

- `R0_INIT` — Environment baseline check
- `R1_CLI_READY` — OpenClaw CLI installed and available on PATH
- `R2_WORKSPACE_READY` — Workspace initialized with required files
- `R3_AUTH_READY` — Provider/auth configured and validated
- `R4_CHANNEL_READY` — One primary channel configured
- `R5_GATEWAY_HEALTHY` — Gateway running and healthy
- `R6_NODE_CONNECTED` — Node/channel connectivity verified
- `R7_SMOKE_PASS` — Round-trip smoke succeeds (`@mention` → agent response)

## Time semantics

- Soft timeout: `45s` local checks, `90s` network checks
- Retries: transient network failures only, `2x` max (`2s`, then `5s` backoff)
- Fail fast: auth/schema errors (no retries)
- Global budget: if total exceeds 5 minutes, stop and print failing state + exact next command

## Commands

### 1) Preflight (R0 → R6)

```bash
./tools/setup/required-first-preflight.sh
```

Expected output pattern on failure:

```text
❌ R3_AUTH_READY
next: openclaw status
```

### 2) Round-trip smoke (R7)

```bash
./tools/setup/required-first-smoke.sh --channel task-comments --mention @link
```

Success requires both:
1. outbound user mention recorded, and
2. agent response observed on the same channel

## Optional (deferred until after first success)

- Additional channels
- Non-critical plugins/integrations
- Custom UX/polish flows
- Advanced automation/rules

## Acceptance mapping

- **AC1 Required-flow lock:** This document + scripts enforce R0→R7 before optional steps.
- **AC2 Confusion reduction:** Required vs Optional is explicitly separated.
- **AC3 State clarity:** Failures emit one state ref + one concrete next action.
- **AC4 Timeout behavior:** Scripted 45s/90s checks, transient retries, auth/schema fail-fast.
- **AC5 End-to-end success:** First-run completion is `R7_SMOKE_PASS` only.
