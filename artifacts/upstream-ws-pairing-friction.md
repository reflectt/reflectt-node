# Upstream: WS Pairing Friction — Token-Auth Auto-Approve

**Task:** `task-1772213897045-3b3b55cna`  
**Author:** Scout · **Reviewer:** Sage  
**Status:** Ready for review

---

## Current Behavior

When a device (CLI, browser, remote agent) connects to an OpenClaw gateway:

1. Device connects via WebSocket
2. Gateway checks device identity against `~/.openclaw/devices/paired.json`
3. If unknown → connection rejected with `1008: pairing required`
4. Pending request created (5-minute TTL) in `~/.openclaw/devices/pending.json`
5. An already-paired device must call `openclaw nodes approve <requestId>` or `device.pair.approve`
6. On approval → token issued, device reconnects

**The problem:** Step 5 requires an already-paired device, creating a chicken-and-egg deadlock for:
- Fresh Docker installs (CLI inside container also needs pairing)
- Headless/managed agent setups (no human to click approve)
- Remote CLI connections even with a valid `OPENCLAW_GATEWAY_TOKEN`

## Existing Upstream Issues

| # | Title | Status | Filed |
|---|-------|--------|-------|
| [#19352](https://github.com/openclaw/openclaw/issues/19352) | Device pairing bootstrap impossible — chicken-and-egg on Docker | Open (stale) |
| [#21688](https://github.com/openclaw/openclaw/issues/21688) | Pairing scope-upgrade loop: repeated reconnects for same device | Open |
| [#22866](https://github.com/openclaw/openclaw/issues/22866) | Device pairing tokens invalidated after gateway restart loop | Open |
| [#21146](https://github.com/openclaw/openclaw/issues/21146) | Pairing-required loops need requestId-aware recovery hints | Open (stale) |

**#19352 is our exact problem.** It has a detailed repro from a Docker user who spent 5+ hours debugging. All workarounds failed: `allowTailscale`, `trustedProxies`, `gateway.auth.mode: "token"`, clearing identity dirs.

## Impact on reflectt-node / Bootstrap

For reflectt-node's managed agent use case, this friction is **critical**:

1. **Docker bootstrap path** — `docker run -d -p 4445:4445 ghcr.io/reflectt/reflectt-node:latest` should just work. If the gateway inside the container can't auto-pair, agents can't execute tools.
2. **Multi-agent teams** — reflectt-node spawns agents that call tools via OpenClaw gateway. Each agent session may create a new device identity → pairing wall.
3. **Cloud enrollment** — our provisioning flow (documented in the Apple-layer spec) needs gateway reachability for preflight check `openclaw-gateway`. If the gateway rejects connections with `pairing required`, the check fails.
4. **Zero-config UX** — Ryan's vision is one command to launch. Manual pairing approval breaks that.

## Proposed Solution Options

### Option A: Token-auth bypass (recommended for upstream)
If a client authenticates with a valid `OPENCLAW_GATEWAY_TOKEN` (via Bearer header or WS auth), **skip device pairing entirely**. The token already proves the client is authorized.

- Lowest friction change
- Consistent with how `gateway.auth.mode: "token"` should behave
- Gateway token is a secret → possessing it should be sufficient
- The `silent: true` hint in `node.pair.request` already exists in the schema but isn't broadly used

### Option B: First-device auto-approve
If no devices are paired yet (`paired.json` is empty), auto-approve the first connection. This solves Docker bootstrap specifically.

- Solves the chicken-and-egg deadlock for new installs
- Doesn't help managed agents on an already-bootstrapped gateway
- Risk: race condition if multiple devices connect simultaneously

### Option C: Programmatic pairing endpoint
Add a REST/CLI endpoint that pre-seeds `paired.json` without requiring a WS connection:

```bash
openclaw devices bootstrap --name "reflectt-agent" --role operator
```

- Most explicit / auditable
- Requires coordination (CLI must have filesystem access to gateway state dir)
- Good for Docker entrypoint scripts

### Option D: Config flag `gateway.pairing.autoApproveLocal: true`
Auto-approve connections from loopback (`127.0.0.1`, `::1`). Already attempted by #19352 user via `trustedProxies` but didn't work.

- Narrowest scope — only local connections skip pairing
- Should work today if `trustedProxies` was plumbed through to device auth
- Doesn't help remote agents

## Recommendation

**Propose Option A upstream** (token-auth bypass) as the primary fix, with **Option B** as a complementary Docker-specific enhancement. Reference #19352 directly.

## Reflectt-Side Mitigations (if upstream rejects)

If upstream won't merge token-auth bypass, we can mitigate in reflectt-node:

1. **Bootstrap entrypoint script** — Pre-seed `paired.json` via a startup script before gateway starts. Write a known device identity directly to the JSON file.
2. **Explicit pairing step in `reflectt-node host join`** — After enrollment, run `openclaw nodes approve` for the reflectt-node device identity programmatically.
3. **Document the workaround** — Add to our Docker quickstart: "Run `openclaw devices list` then `openclaw devices approve <id>` inside the container on first boot."

---

## Next Step

File upstream issue referencing #19352 with our Option A proposal + impact evidence from reflectt-node managed agents.
