# Apple-Layer Enroll + Preflight Spec

**Author:** Scout · **Status:** Draft for Review · **Reviewer:** Kai  
**Task:** `task-1772201860586-3a1d54g7w`  
**Source files:** `src/preflight.ts` (821 lines) · `src/provisioning.ts` (595 lines)

---

## Overview

reflectt-node's onboarding has two sequential stages:

1. **Preflight** — validates the host is ready (system, network, auth, macOS permissions)
2. **Enrollment** — registers the host with Reflectt Cloud and pulls config/secrets/webhooks

The "Apple layer" is the macOS-specific preflight category that checks TCC permissions (Screen Recording, Accessibility) and OpenClaw Gateway status. These are **warn-only** — they never block enrollment.

---

## Preflight (`src/preflight.ts`)

### Check Execution Order

| Phase | Check ID | Category | Blocking? | What it does |
|-------|----------|----------|-----------|--------------|
| 1 | `node-version` | version | Yes | Node.js >= 20 |
| 1 | `home-writable` | system | Yes | REFLECTT_HOME exists + writable |
| 1 | `port-available` | system | Yes | Port 4445 not in use |
| 1b | `macos-screen-recording` | apple | No (warn) | TCC kTCCServiceScreenCapture granted to Terminal/iTerm |
| 1b | `macos-accessibility` | apple | No (warn) | TCC kTCCServiceAccessibility granted to Terminal/iTerm |
| 1b | `openclaw-gateway` | system | No (warn) | `openclaw gateway status` returns running + rpc.ok |
| 2 | `cloud-reachable` | network | Yes | HTTPS GET to cloud /api/health |
| 3 | `auth-valid` | auth | Yes | Validate join token or API key format + cloud roundtrip |

### Apple Layer Detail

**How TCC checks work:**
- Reads `~/Library/Application Support/com.apple.TCC/TCC.db` via `sqlite3 -readonly`
- Queries the `access` table for `kTCCServiceScreenCapture` / `kTCCServiceAccessibility`
- Looks for `com.apple.Terminal` and `com.googlecode.iterm2` as clients
- Any `auth_value > 0` (or `allowed > 0` on older schemas) = granted
- Falls back gracefully: DB not found → warn; no rows → warn with recovery steps
- Timeout: 2.5s per query

**Recovery guidance includes:**
- System Settings deep link (`x-apple.systempreferences:com.apple.preference.security?Privacy_*`)
- Which app to enable (Terminal / iTerm)
- Instruction to restart terminal after granting

**OpenClaw Gateway check:**
- Runs `openclaw gateway status --json --timeout 5000`
- Parses JSON for `service.runtime.status === 'running'` and `rpc.ok === true`
- Falls back to warn if can't parse output

### Result Shape

```typescript
interface PreflightResult {
  check: { id, name, description, category }
  passed: boolean        // Apple checks always pass (true) — severity in level
  level?: 'pass' | 'warn' | 'fail'
  message: string
  recovery?: string[]    // Actionable steps
  details?: Record<string, unknown>
  durationMs: number
}
```

### Activation Events

On completion, emits either `host_preflight_passed` or `host_preflight_failed` with:
- `checks_run`, `passed_checks`, `failed_checks`, `first_blocker`, `total_duration_ms`, `pid`
- Tracking ID: `userId` from options, or `host-{hostname()}`

### Entry Points

| Surface | How to invoke |
|---------|--------------|
| CLI | `reflectt-node start` (runs preflight before server boot) |
| HTTP GET | `/preflight` → JSON report |
| HTTP POST | `/preflight` → JSON report (accepts body options) |
| HTTP GET | `/preflight/text` → formatted CLI-style text |

---

## Enrollment (`src/provisioning.ts`)

### Phase Machine

```
unprovisioned → enrolling → pulling_config → pulling_secrets → configuring_webhooks → ready
                                              ↓ (any failure)
                                             error
```

### Enrollment Flow

1. **Enroll** — POST `/api/hosts/claim` (join token) or `/api/hosts/enroll` (API key)
   - Sends: `{ joinToken?, name, capabilities }`
   - Receives: `{ host: { id }, credential: { token } }`
   - Persists `hostId` + `credential` to `~/.reflectt/config.json` and `provisioning.json`

2. **Pull Config** — GET `/api/hosts/{hostId}/config` (Bearer credential)
   - Saves cloud config to `~/.reflectt/cloud-config.json`
   - 404 = silently skipped (cloud endpoint may not exist yet)

3. **Pull Secrets** — GET `/api/hosts/{hostId}/secrets`
   - Receives encrypted secrets with wrapped DEKs
   - Logs receipt; full import requires vault.import() with source HMK
   - 404 = silently skipped

4. **Configure Webhooks** — GET `/api/hosts/{hostId}/webhooks`
   - Merges cloud-configured webhooks into local state
   - Stores signing secrets in SecretVault
   - 404 = silently skipped

### CLI Entry Points

| Command | What it does |
|---------|-------------|
| `reflectt-node host join --join-token <t>` | Full provision flow |
| `reflectt-node host join --api-key <k>` | Enroll via API key (agent-friendly, no browser) |
| `reflectt-node host status` | Show provisioning state + cloud enrollment info |

### State Persistence

- `~/.reflectt/provisioning.json` — full provisioning state (phase, hostId, webhooks, timestamps)
- `~/.reflectt/config.json` — cloud credentials (hostId, credential, cloudUrl, hostName)
- `~/.reflectt/cloud-config.json` — team settings pulled from cloud

### Idempotency

`provision()` skips already-completed phases. `refresh()` re-pulls config/secrets/webhooks without re-enrolling. `reset()` wipes state for full re-enrollment.

---

## Acceptance Criteria

1. ✅ This spec accurately documents the preflight check order, Apple-layer behavior, and enrollment flow as implemented in source
2. ✅ All entry points (CLI, HTTP, programmatic) are documented
3. ✅ Recovery guidance and deep links for macOS permissions are captured
4. ✅ Enrollment phase machine and state persistence are specified
5. ✅ Cloud API endpoints and expected request/response shapes are documented

---

## 3-Minute Demo Script

> Demonstrates the full preflight → enroll path on a macOS host.

### Setup (30s)
```bash
# Ensure reflectt-node is installed
npm install -g reflectt-node

# Verify no existing enrollment
cat ~/.reflectt/provisioning.json 2>/dev/null || echo "Fresh host — no provisioning state"
```

### Run Preflight (60s)
```bash
# Text output — shows all checks including Apple layer
curl -s http://localhost:4445/preflight/text

# Expected output on macOS:
# ✅ Node.js Version: Node.js v22.x.x ✓
# ✅ Home Directory: ~/.reflectt exists and is writable ✓
# ✅ Port Available: Port 4445 is available ✓
# ⚠️  macOS Screen Recording: not granted (com.apple.Terminal=0)
# ⚠️  macOS Accessibility: not granted (com.apple.Terminal=0)
# ✅ OpenClaw Gateway: Gateway running (pid 12345) at ws://127.0.0.1:... ✓
# ✅ Cloud Connectivity: Cloud reachable at https://app.reflectt.ai (200) ✓
# All 7 preflight checks passed ✓

# JSON output for programmatic use
curl -s http://localhost:4445/preflight | python3 -m json.tool | head -30
```

### Fix Apple Warnings (30s)
```bash
# Open Screen Recording settings directly
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
# → Enable Terminal/iTerm, restart terminal

# Open Accessibility settings
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
# → Enable Terminal/iTerm
```

### Enroll Host (60s)
```bash
# Option A: Join token from dashboard
reflectt-node host join --join-token <token-from-dashboard>

# Option B: API key (agent-friendly, no browser)
reflectt-node host join --api-key <team-api-key> --cloud-url https://app.reflectt.ai

# Verify enrollment
reflectt-node host status
# Expected: phase=ready, hostId=host_xxx, enrolledAt=..., provisionedAt=...
```

### Verify State (30s)
```bash
# Check persisted state
cat ~/.reflectt/provisioning.json | python3 -m json.tool
# Should show: phase "ready", hostId, webhooks array, timestamps

# Re-run preflight — all green now
curl -s http://localhost:4445/preflight/text
```

---

*Spec generated from source. Last verified against `src/preflight.ts` (821 lines) and `src/provisioning.ts` (595 lines).*
