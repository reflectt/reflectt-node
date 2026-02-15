# Reflectt Open/Core + Cloud Boundary

This document defines the product and licensing boundary between the open-source `reflectt-node` project and Reflectt Cloud.

## Product Boundary

| Area | Open Source (`reflectt-node`) | Closed Source (Reflectt Cloud) |
|---|---|---|
| Runtime | Local/self-hosted agent runtime | Managed hosted runtime for teams |
| Core APIs | Task/chat/presence/health/events APIs | Multi-tenant cloud control-plane APIs |
| Dashboard | Local dashboard UI served by `reflectt-node` | Team/org cloud dashboard + account/workspace admin |
| Data | Local/self-managed persistence | Managed persistent storage, backups, retention controls |
| Identity | Local/simple auth patterns (if configured) | Org identity, invites, RBAC, SSO, policy controls |
| Operations | Self-managed deploy/restart/monitoring | Managed deploys, upgrades, rollback, SLA-backed operations |
| Observability | Local endpoint metrics and health views | Fleet-level analytics, alerting, audit/compliance history |
| Billing | N/A | Subscription, metering, invoicing, plan controls |

## License Summary

`reflectt-node` is licensed under **Apache License 2.0**.

Why Apache-2.0 for open core:
- Permissive adoption model
- Explicit patent grant
- Enterprise-friendly legal posture
- Supports ecosystem growth around the core runtime

## Cloud Value Proposition

Reflectt Cloud is paid because it removes operational burden and adds team-scale governance.

Core paid value:
- Zero-ops hosted reliability (no local infra babysitting)
- Team/org access control and policy enforcement
- Durable shared history and cross-workspace visibility
- Managed upgrades, rollback, and operational support
- Compliance/audit and enterprise-ready controls

In short: **open engine for distribution, paid control plane for reliability and governance at scale.**

## Trademark Note

`Reflectt` and related logos/brand assets are trademarks of Reflectt.

Apache-2.0 applies to source code in this repository. Trademark rights are **not** granted by the open-source license.

- You may accurately reference compatibility with `reflectt-node`.
- You may not imply affiliation, endorsement, or official status without permission.
- Use of Reflectt marks in product names, branding, or marketing requires explicit approval.
