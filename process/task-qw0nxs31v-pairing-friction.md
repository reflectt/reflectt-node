# Task: WS Pairing Friction for Remote Agent Onboarding

**Task ID:** task-1772213896973-qw0nxs31v
**PR:** https://github.com/reflectt/reflectt-node/pull/586
**Author:** harmony

## Root Cause
OpenClaw requires device pairing for new device IDs on non-local connections. Gateway auth token authenticates the connection but does not bypass device pairing. This is by-design security.

## Fix Applied
- Documented workarounds in GETTING-STARTED.md (same-machine, Tailscale, pre-approve)
- Added troubleshooting entry for pairing-stuck scenario
- Added gateway connection section under "Connect your agents"

## Upstream Feature Request
`gateway.nodes.autoApproveWithToken: true` — auto-approve device pairing when valid token is presented. Outside our repo.

## Done Criteria
- [x] Root cause addressed (documented workaround) or mitigated
- [x] Evidence validated (confirmed via protocol docs + `openclaw nodes` CLI)
- [x] Follow-up reflection submitted (ref-1772414653079)
