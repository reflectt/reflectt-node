# Dashboard Panel Reference

Snapshot reference for key dashboard panels and their data sources.

## Panels

| Panel | Purpose | Primary endpoint |
|---|---|---|
| Task Board | Task status visibility by column | `GET /tasks` |
| Available Work | Unassigned todo queue | `GET /tasks/backlog` |
| Team Health | Agent status + blockers | `GET /health/team`, `GET /health/agents` |
| Compliance | SLA/cadence view | `GET /health/compliance` |
| Promotion SSOT | ops links + freshness signal | static links + remote metadata |
| Chat | operational coordination stream | `GET /chat/messages` |
| Activity | recent events feed | `GET /activity` |

## Refresh behavior
- foreground: adaptive 20–30s polling
- background: ~60s polling
- periodic full sync to reconcile deltas

## Debug tips
- if panel is empty, verify endpoint returns data directly
- if counts stale, force full refresh and compare `updatedAt`/timestamps
- if link refs fail, check task IDs exist in current `/tasks` payload
