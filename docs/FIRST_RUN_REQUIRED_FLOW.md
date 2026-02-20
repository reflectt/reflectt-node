# First-Run Required Flow (reflectt-node, R0 → R7)

This is the canonical first-run path for getting **reflectt-node** from clone to usable local runtime.

> Required-first rule: do only R0 → R7 for first success.
> Optional enhancements are deferred until after `R7_SMOKE_PASS`.

## Required states

- `R0_INIT` — Local toolchain baseline (bash/curl/node/npm)
- `R1_DEPS_READY` — Node dependencies installed (`node_modules` present)
- `R2_WORKSPACE_READY` — reflectt-node workspace files present
- `R3_BUILD_READY` — TypeScript build passes
- `R4_API_HEALTHY` — Local API health endpoint responds
- `R5_TASKS_API_READY` — Tasks API responds
- `R6_CHAT_API_READY` — Chat API responds
- `R7_SMOKE_PASS` — Round-trip smoke succeeds (`@mention` → non-smoke response)

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
❌ R1_DEPS_READY
next: npm ci
```

### 2) Round-trip smoke (R7)

```bash
./tools/setup/required-first-smoke.sh --channel task-comments --mention @link
```

Success requires both:
1. outbound mention recorded, and
2. a non-smoke response observed on the same channel.

## Optional (deferred until after first success)

- Additional channels/integrations
- Non-critical plugin setup
- UX/polish flows
- Advanced automation/rules

## Acceptance mapping

- **AC1 Required-flow lock:** This document + scripts enforce R0→R7 before optional steps.
- **AC2 Confusion reduction:** Required vs Optional is explicitly separated.
- **AC3 State clarity:** Failures emit one state ref + one concrete next action.
- **AC4 Timeout behavior:** Scripted 45s/90s checks, transient retries, auth/schema fail-fast.
- **AC5 End-to-end success:** First-run completion is `R7_SMOKE_PASS` only.
